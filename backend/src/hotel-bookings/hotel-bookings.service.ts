import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { assertOwnedBy } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { PLATFORM_CURRENCY } from '../common/currency';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { refundAmount } from '../flight-bookings/flight-booking-rules';
import { hotelNow, nightsBetween } from '../hotels/hotel-dates';
import { HotelStayStatusService } from '../hotels/hotel-stay-status.service';
import {
  occupyingReservation,
  roomIsFree,
  RoomsService,
} from '../hotels/rooms.service';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { RoomAvailability } from '../hotels/schemas/room-availability.schema';
import { Room } from '../hotels/schemas/room.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../payments/schemas/refund.schema';
import { City } from '../reference-data/schemas/city.schema';
import { UserDocument } from '../users/schemas/user.schema';
import {
  CancelledHotelBookingDto,
  CreateHotelBookingDto,
  HotelBookingDto,
  HotelBookingListDto,
  ListHotelBookingsQueryDto,
  ReservationGroup,
} from './dto/hotel-booking.dto';
import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBooking } from './schemas/hotel-booking.schema';

/** The 10-minute hold while the traveler pays (HTL-18). */
export const HOLD_MINUTES = 10;

const NOT_FOUND = 'Reservation not found.';

type StoredBooking = HotelBooking & {
  _id: Types.ObjectId;
  createdAt?: Date;
};

/**
 * HTL-10, HTL-21: the tier with the highest threshold not above the whole
 * days left before check-in decides the refund (same rule as FLT-09); no
 * matching tier means 0%.
 */
export function hotelRefundPercentage(
  tiers: { daysBeforeCheckIn: number; refundPercentage: number }[],
  daysLeft: number,
): number {
  const tier = tiers
    .filter((candidate) => candidate.daysBeforeCheckIn <= daysLeft)
    .sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn)[0];
  return tier?.refundPercentage ?? 0;
}

/** HTL-16 to HTL-21: reserving rooms, viewing and cancelling reservations. */
@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailability>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    private readonly roomsService: RoomsService,
    private readonly lifecycle: HotelBookingLifecycleService,
    private readonly stayStatus: HotelStayStatusService,
  ) {}

  /**
   * HTL-16, HTL-18: hold every selected room together for 10 minutes as
   * one Pending Payment reservation. If any room is taken, blocked or not
   * bookable for the whole stay, nothing is held. Rooms are locked first
   * (Phase 7 contract), so simultaneous requests cannot both get a room.
   */
  async create(
    user: UserDocument,
    dto: CreateHotelBookingDto,
    now = new Date(),
  ): Promise<HotelBookingDto> {
    const roomIds = dto.rooms.map((room) => room.roomId);
    if (new Set(roomIds).size !== roomIds.length)
      throw new BadRequestException('Select each room only once.');
    if (!dto.rooms.some((room) => room.adults > 0))
      throw new BadRequestException(
        'The reservation needs at least one adult.',
      );
    const emptyRoom = dto.rooms.findIndex(
      (room) => room.adults + (room.childAges?.length ?? 0) === 0,
    );
    if (emptyRoom >= 0)
      throw new BadRequestException(
        `Room ${emptyRoom + 1} in the request has no guests.`,
      );

    const stay = { fromDate: dto.checkInDate, untilDate: dto.checkOutDate };
    const nights = nightsBetween(stay.fromDate, stay.untilDate);
    await this.lifecycle.expireDueHolds(now, {
      'rooms.roomId': { $in: roomIds.map((id) => new Types.ObjectId(id)) },
    });

    const bookingId = await this.connection.transaction(async (session) => {
      const hotel = await this.hotels
        .findById(dto.hotelId)
        .session(session)
        .lean()
        .exec();
      if (!hotel) throw new NotFoundException('Hotel not found.');
      if (!hotel.isActive)
        throw new ConflictException('This hotel is not taking bookings.');
      if (!hotel.policy)
        throw new ConflictException(
          'This hotel cannot take bookings until it sets its policies.',
        );
      this.roomsService.checkStay(stay, hotel.timeZone, now);

      const ids = roomIds.map((id) => new Types.ObjectId(id));
      await this.roomsService.lockAvailability(ids, session);
      const rooms = await this.rooms
        .find({ _id: { $in: ids }, hotelId: hotel._id })
        .session(session)
        .lean()
        .exec();
      if (rooms.length !== ids.length)
        throw new NotFoundException(
          'One or more rooms were not found in this hotel.',
        );
      const roomById = new Map(
        rooms.map((room) => [room._id.toString(), room]),
      );

      for (const request of dto.rooms) {
        const room = roomById.get(request.roomId)!;
        const guests = request.adults + (request.childAges?.length ?? 0);
        if (guests > room.maxOccupancy)
          throw new BadRequestException(
            `Room ${room.label} holds at most ${room.maxOccupancy} guests.`,
          );
      }

      const [records, occupied] = await Promise.all([
        this.availability
          .find({ roomId: { $in: ids } })
          .session(session)
          .lean()
          .exec(),
        this.bookings
          .find({
            'rooms.roomId': { $in: ids },
            checkInDate: { $lt: stay.untilDate },
            checkOutDate: { $gt: stay.fromDate },
            ...occupyingReservation(now),
          })
          .select('rooms.roomId')
          .session(session)
          .lean()
          .exec(),
      ]);
      const recordByRoom = new Map(
        records.map((record) => [record.roomId.toString(), record]),
      );
      const takenIds = new Set(
        occupied.flatMap((b) => b.rooms.map((r) => r.roomId.toString())),
      );
      const unavailable = rooms.filter((room) => {
        const record = recordByRoom.get(room._id.toString());
        return (
          !record ||
          !roomIsFree(room, record, stay, takenIds.has(room._id.toString()))
        );
      });
      if (unavailable.length > 0)
        throw new ConflictException(
          `Not free for the whole stay: room ${unavailable.map((room) => room.label).join(', ')}. Nothing was held.`,
        );

      const [booking] = await this.bookings.create(
        [
          {
            userId: user._id,
            hotelId: hotel._id,
            checkInDate: stay.fromDate,
            checkOutDate: stay.untilDate,
            timeZone: hotel.timeZone,
            rooms: dto.rooms.map((request) => {
              const room = roomById.get(request.roomId)!;
              return {
                roomId: room._id,
                label: room.label,
                maxOccupancy: room.maxOccupancy,
                nightlyPriceMinorUnits: room.nightlyPriceMinorUnits,
                adults: request.adults,
                childAges: request.childAges ?? [],
              };
            }),
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
            policy: hotel.policy,
            currency: PLATFORM_CURRENCY,
            totalMinorUnits:
              nights *
              rooms.reduce((sum, room) => sum + room.nightlyPriceMinorUnits, 0),
          },
        ],
        { session },
      );
      return booking._id;
    });
    return this.details(user, bookingId.toString(), now);
  }

  /** HTL-20: the traveler's reservations in one group, 10 per page. */
  async list(
    user: UserDocument,
    query: ListHotelBookingsQueryDto,
    now = new Date(),
  ): Promise<HotelBookingListDto> {
    await this.lifecycle.expireDueHolds(now, { userId: user._id });
    await this.stayStatus.completeFinishedStays(now, { userId: user._id });
    const group = query.group ?? ReservationGroup.UPCOMING;
    const page = query.page ?? 1;
    const byGroup = {
      [ReservationGroup.UPCOMING]: {
        statuses: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
        sort: { checkInDate: 1, _id: 1 } as Record<string, 1 | -1>,
      },
      [ReservationGroup.PAST]: {
        statuses: [BookingStatus.COMPLETED],
        sort: { checkInDate: -1, _id: -1 } as Record<string, 1 | -1>,
      },
      [ReservationGroup.CANCELLED]: {
        statuses: [BookingStatus.CANCELLED, BookingStatus.EXPIRED],
        sort: { updatedAt: -1, _id: -1 } as Record<string, 1 | -1>,
      },
    }[group];
    const filter = { userId: user._id, status: { $in: byGroup.statuses } };
    const [bookings, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort(byGroup.sort)
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const present = await this.presenter(bookings, now);
    return {
      group,
      ...pageInfo(page, total),
      items: bookings.map(present),
    };
  }

  /** HTL-20: one of the traveler's own reservations, in full. */
  async details(
    user: UserDocument,
    id: string,
    now = new Date(),
  ): Promise<HotelBookingDto> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(NOT_FOUND);
    const owned = { _id: new Types.ObjectId(id), userId: user._id };
    await this.lifecycle.expireDueHolds(now, owned);
    await this.stayStatus.completeFinishedStays(now, owned);
    const booking = await this.bookings.findById(id).lean().exec();
    if (!booking) throw new NotFoundException(NOT_FOUND);
    assertOwnedBy(user, booking.userId, NOT_FOUND);
    const present = await this.presenter([booking], now);
    return Object.assign(present(booking), {
      refund: await this.refundFor(booking._id),
    });
  }

  /**
   * HTL-21: cancel a confirmed reservation as a whole before its check-in
   * date. Every room is free again for those dates, and the refund follows
   * the hotel tiers agreed at booking time, on the full total.
   */
  async cancel(
    user: UserDocument,
    id: string,
    now = new Date(),
  ): Promise<CancelledHotelBookingDto> {
    return this.connection.transaction(async (session) => {
      const booking = await this.loadOwn(user, id, session);
      if (booking.status !== BookingStatus.CONFIRMED)
        throw new ConflictException(
          'Only a confirmed reservation can be cancelled.',
        );
      const quote = this.cancellationQuote(booking, now);
      if (!quote.allowed)
        throw new ConflictException(
          'A reservation can only be cancelled before its check-in date.',
        );
      // Serializes with room schedule changes (Phase 7 contract).
      await this.roomsService.lockAvailability(
        booking.rooms.map((room) => room.roomId),
        session,
      );
      const changed = await this.bookings
        .updateOne(
          { _id: booking._id, status: BookingStatus.CONFIRMED },
          { $set: { status: BookingStatus.CANCELLED } },
          { session },
        )
        .exec();
      if (changed.modifiedCount !== 1)
        throw new ConflictException('This reservation was already changed.');

      if (quote.refundMinorUnits > 0) {
        const payment = await this.payments
          .findOne({
            bookingModel: 'HotelBooking' as const,
            bookingId: booking._id,
            status: PaymentStatus.SUCCEEDED,
          })
          .session(session)
          .exec();
        if (!payment)
          throw new ConflictException(
            'No successful payment was found for this reservation, so the refund cannot be recorded.',
          );
        if (
          await this.refunds.exists({ paymentId: payment._id }).session(session)
        )
          throw new ConflictException(
            'A refund already exists for this payment.',
          );
        await this.refunds.create(
          [
            {
              paymentId: payment._id,
              amountMinorUnits: quote.refundMinorUnits,
              currency: payment.currency,
              status: RefundStatus.PENDING,
            },
          ],
          { session },
        );
        // TODO(PAY-03): the payment service sends pending refunds to Stripe
        // and notifies the traveler when the refund status changes.
      }

      await this.notifications.create(
        [
          {
            recipientId: booking.userId,
            type: NotificationType.BOOKING_CANCELLED,
            subjectModel: HotelBooking.name,
            subjectId: booking._id,
            title: 'Hotel reservation cancelled',
            message:
              quote.refundMinorUnits > 0
                ? `Your reservation ${booking.reference} was cancelled. A refund of ${quote.refundPercentage}% (${quote.refundMinorUnits} ${booking.currency} minor units) is being processed.`
                : `Your reservation ${booking.reference} was cancelled. No refund is due under the hotel's cancellation policy.`,
            eventKey: `hotel-booking-cancelled:${booking._id.toString()}`,
          },
        ],
        { session },
      );

      return {
        id: booking._id.toString(),
        status: BookingStatus.CANCELLED,
        refundPercentage: quote.refundPercentage,
        refundMinorUnits: quote.refundMinorUnits,
        currency: booking.currency,
        refundStatus: quote.refundMinorUnits > 0 ? 'pending' : 'none',
      };
    });
  }

  private cancellationQuote(
    booking: Pick<
      HotelBooking,
      'checkInDate' | 'timeZone' | 'policy' | 'totalMinorUnits'
    >,
    now: Date,
  ) {
    const today = hotelNow(booking.timeZone, now).date;
    const allowed = today < booking.checkInDate;
    const percentage = allowed
      ? hotelRefundPercentage(
          booking.policy.cancellationTiers,
          nightsBetween(today, booking.checkInDate),
        )
      : 0;
    return {
      allowed,
      refundPercentage: percentage,
      refundMinorUnits: refundAmount(booking.totalMinorUnits, percentage),
    };
  }

  /** Loads hotels and cities once, then presents each reservation. */
  private async presenter(bookings: StoredBooking[], now: Date) {
    const hotels = await this.hotels
      .find({ _id: { $in: bookings.map((b) => b.hotelId) } })
      .select('name address cityId timeZone')
      .lean()
      .exec();
    const cities = await this.cities
      .find({ _id: { $in: hotels.map((h) => h.cityId) } })
      .lean()
      .exec();
    const hotelById = new Map(hotels.map((h) => [h._id.toString(), h]));
    const cityName = new Map(cities.map((c) => [c._id, c.name]));

    return (booking: StoredBooking): HotelBookingDto => {
      const hotel = hotelById.get(booking.hotelId.toString());
      const nights = nightsBetween(booking.checkInDate, booking.checkOutDate);
      return {
        id: booking._id.toString(),
        reference: booking.reference,
        status: booking.status,
        hotel: {
          id: booking.hotelId.toString(),
          name: hotel?.name ?? 'Unknown hotel',
          address: hotel?.address ?? '',
          cityName: hotel ? (cityName.get(hotel.cityId) ?? hotel.cityId) : '',
          timeZone: booking.timeZone,
        },
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        nights,
        checkInTime: booking.policy.checkInTime,
        checkOutTime: booking.policy.checkOutTime,
        rooms: booking.rooms.map((room) => ({
          roomId: room.roomId.toString(),
          label: room.label,
          adults: room.adults,
          childAges: room.childAges,
          maxOccupancy: room.maxOccupancy,
          nightlyPriceMinorUnits: room.nightlyPriceMinorUnits,
          stayPriceMinorUnits: nights * room.nightlyPriceMinorUnits,
        })),
        guests: booking.rooms.reduce(
          (sum, room) => sum + room.adults + room.childAges.length,
          0,
        ),
        totalMinorUnits: booking.totalMinorUnits,
        currency: booking.currency,
        cancellationTiers: booking.policy.cancellationTiers.map((tier) => ({
          daysBeforeCheckIn: tier.daysBeforeCheckIn,
          refundPercentage: tier.refundPercentage,
        })),
        holdExpiresAt: booking.holdExpiresAt,
        policyAcceptedAt: booking.policyAcceptedAt,
        cancellation:
          booking.status === BookingStatus.CONFIRMED
            ? this.cancellationQuote(booking, now)
            : undefined,
        createdAt: booking.createdAt as Date,
      };
    };
  }

  private async loadOwn(
    user: UserDocument,
    id: string,
    session: ClientSession,
  ) {
    const booking = Types.ObjectId.isValid(id)
      ? await this.bookings.findById(id).session(session).exec()
      : null;
    if (!booking) throw new NotFoundException(NOT_FOUND);
    assertOwnedBy(user, booking.userId, NOT_FOUND);
    return booking;
  }

  /** PAY-03: the refund of this booking's successful payment, if any. */
  private async refundFor(bookingId: Types.ObjectId) {
    const payment = await this.payments
      .findOne({
        bookingModel: 'HotelBooking' as const,
        bookingId,
        status: PaymentStatus.SUCCEEDED,
      })
      .select('_id')
      .lean()
      .exec();
    const refund = payment
      ? await this.refunds.findOne({ paymentId: payment._id }).lean().exec()
      : null;
    return refund
      ? {
          id: refund._id.toString(),
          amountMinorUnits: refund.amountMinorUnits,
          currency: refund.currency,
          status: refund.status,
        }
      : undefined;
  }
}
