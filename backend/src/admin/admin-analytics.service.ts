import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { BookingStatus } from '../common/booking-status';
import { PLATFORM_CURRENCY } from '../common/currency';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { addDays } from '../hotels/hotel-dates';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../payments/schemas/refund.schema';
import {
  AnalyticsDto,
  AnalyticsFiguresDto,
  AnalyticsProviderType,
  AnalyticsQueryDto,
} from './dto/admin-analytics.dto';

const MAX_DAYS = 366;

/** A booking's paid amount split between the providers it belongs to. */
interface Share {
  type: AnalyticsProviderType;
  providerId: string;
  amount: number;
}

/**
 * Splits a flight booking by segment: each airline earns the fares and bag
 * fees of its own flight, so a round trip on two airlines is split fairly.
 */
export function flightShares(
  booking: Pick<FlightBooking, 'segments' | 'passengers'>,
): Share[] {
  return booking.segments.map((segment, index) => ({
    type: AnalyticsProviderType.AIRLINE,
    providerId: segment.airlineId.toString(),
    amount: booking.passengers.reduce(
      (sum, p) =>
        sum +
        p.segments[index].fareMinorUnits +
        p.segments[index].baggageFeeMinorUnits,
      0,
    ),
  }));
}

const empty = (): Pick<AnalyticsFiguresDto, keyof AnalyticsFiguresDto> => ({
  bookings: 0,
  cancelledBookings: 0,
  grossRevenueMinorUnits: 0,
  refundsMinorUnits: 0,
  netRevenueMinorUnits: 0,
});

/**
 * BON-01 (optional): bookings and revenue per airline and hotel for bookings
 * paid in the period (the payment's success date, UTC). Refunds already
 * issued or pending for those bookings are subtracted for net revenue.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
  ) {}

  async report(
    query: AnalyticsQueryDto,
    now = new Date(),
  ): Promise<AnalyticsDto> {
    const toDate = query.toDate ?? now.toISOString().slice(0, 10);
    const fromDate = query.fromDate ?? addDays(toDate, -29);
    if (fromDate > toDate)
      throw new BadRequestException('fromDate cannot be after toDate.');
    if (Date.parse(toDate) - Date.parse(fromDate) > MAX_DAYS * 86_400_000)
      throw new BadRequestException(`Choose at most ${MAX_DAYS} days.`);

    const models: ('FlightBooking' | 'HotelBooking')[] =
      query.providerType === AnalyticsProviderType.AIRLINE
        ? ['FlightBooking']
        : query.providerType === AnalyticsProviderType.HOTEL
          ? ['HotelBooking']
          : ['FlightBooking', 'HotelBooking'];
    const payments = await this.payments
      .find({
        bookingModel: { $in: models },
        status: PaymentStatus.SUCCEEDED,
        updatedAt: {
          $gte: new Date(`${fromDate}T00:00:00.000Z`),
          $lt: new Date(`${addDays(toDate, 1)}T00:00:00.000Z`),
        },
      })
      .lean()
      .exec();
    const idsFor = (model: string) =>
      payments.filter((p) => p.bookingModel === model).map((p) => p.bookingId);
    const [flightBookings, hotelBookings, refunds] = await Promise.all([
      this.flightBookings
        .find({ _id: { $in: idsFor('FlightBooking') } })
        .select('status segments passengers.segments')
        .lean()
        .exec(),
      this.hotelBookings
        .find({ _id: { $in: idsFor('HotelBooking') } })
        .select('status hotelId')
        .lean()
        .exec(),
      this.refunds
        .find({
          paymentId: { $in: payments.map((p) => p._id) },
          status: { $in: [RefundStatus.REFUNDED, RefundStatus.PENDING] },
        })
        .lean()
        .exec(),
    ]);
    const flightById = new Map(
      flightBookings.map((b) => [b._id.toString(), b]),
    );
    const hotelById = new Map(hotelBookings.map((b) => [b._id.toString(), b]));
    const refundByPayment = new Map<string, number>();
    for (const refund of refunds)
      refundByPayment.set(
        refund.paymentId.toString(),
        (refundByPayment.get(refund.paymentId.toString()) ?? 0) +
          refund.amountMinorUnits,
      );

    const byProvider = new Map<
      string,
      AnalyticsFiguresDto & Omit<Share, 'amount'>
    >();
    const totals = empty();
    for (const payment of payments) {
      const id = payment.bookingId.toString();
      const flight = flightById.get(id);
      const hotel = hotelById.get(id);
      const shares: Share[] = flight
        ? flightShares(flight)
        : hotel
          ? [
              {
                type: AnalyticsProviderType.HOTEL,
                providerId: hotel.hotelId.toString(),
                amount: payment.amountMinorUnits,
              },
            ]
          : [];
      if (!shares.length) continue;
      const status = (flight ?? hotel)!.status;
      const cancelled = status === BookingStatus.CANCELLED;
      const refunded = refundByPayment.get(payment._id.toString()) ?? 0;
      const shareTotal = shares.reduce((s, x) => s + x.amount, 0) || 1;

      totals.bookings++;
      if (cancelled) totals.cancelledBookings++;
      totals.grossRevenueMinorUnits += payment.amountMinorUnits;
      totals.refundsMinorUnits += refunded;

      // A provider on two segments of one booking counts it once.
      const counted = new Set<string>();
      shares.forEach((share, index) => {
        const key = `${share.type}:${share.providerId}`;
        const row =
          byProvider.get(key) ??
          Object.assign(empty(), {
            type: share.type,
            providerId: share.providerId,
          });
        // The last share takes the rounding remainder, so shares add up exactly.
        const isLast = index === shares.length - 1;
        const gross = isLast
          ? payment.amountMinorUnits -
            shares
              .slice(0, -1)
              .reduce(
                (s, x) =>
                  s +
                  Math.round(
                    (x.amount / shareTotal) * payment.amountMinorUnits,
                  ),
                0,
              )
          : Math.round((share.amount / shareTotal) * payment.amountMinorUnits);
        const refund = isLast
          ? refunded -
            shares
              .slice(0, -1)
              .reduce(
                (s, x) => s + Math.round((x.amount / shareTotal) * refunded),
                0,
              )
          : Math.round((share.amount / shareTotal) * refunded);
        if (!counted.has(key)) {
          row.bookings++;
          if (cancelled) row.cancelledBookings++;
          counted.add(key);
        }
        row.grossRevenueMinorUnits += gross;
        row.refundsMinorUnits += refund;
        byProvider.set(key, row);
      });
    }
    totals.netRevenueMinorUnits =
      totals.grossRevenueMinorUnits - totals.refundsMinorUnits;

    const rows = [...byProvider.values()].map((row) =>
      Object.assign(row, {
        netRevenueMinorUnits:
          row.grossRevenueMinorUnits - row.refundsMinorUnits,
      }),
    );
    const [airlines, hotels] = await Promise.all([
      this.airlines
        .find({
          _id: {
            $in: rows
              .filter((r) => r.type === AnalyticsProviderType.AIRLINE)
              .map((r) => new Types.ObjectId(r.providerId)),
          },
        })
        .select('name')
        .lean()
        .exec(),
      this.hotels
        .find({
          _id: {
            $in: rows
              .filter((r) => r.type === AnalyticsProviderType.HOTEL)
              .map((r) => new Types.ObjectId(r.providerId)),
          },
        })
        .select('name')
        .lean()
        .exec(),
    ]);
    const nameOf = new Map(
      [...airlines, ...hotels].map((p) => [p._id.toString(), p.name]),
    );
    rows.sort(
      (a, b) =>
        b.netRevenueMinorUnits - a.netRevenueMinorUnits ||
        a.providerId.localeCompare(b.providerId),
    );
    const page = query.page ?? 1;
    return {
      fromDate,
      toDate,
      currency: PLATFORM_CURRENCY,
      totals,
      ...pageInfo(page, rows.length),
      items: rows
        .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        .map((row) => ({
          providerType: row.type,
          providerId: row.providerId,
          name: nameOf.get(row.providerId) ?? 'Unknown provider',
          bookings: row.bookings,
          cancelledBookings: row.cancelledBookings,
          grossRevenueMinorUnits: row.grossRevenueMinorUnits,
          refundsMinorUnits: row.refundsMinorUnits,
          netRevenueMinorUnits: row.netRevenueMinorUnits,
        })),
    };
  }
}
