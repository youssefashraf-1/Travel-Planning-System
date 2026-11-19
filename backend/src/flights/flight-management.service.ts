import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Airport } from '../airports/schemas/airport.schema';
import { assertManagesProvider, ProviderType } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { PassengerType } from '../flight-bookings/schemas/passenger.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../payments/schemas/refund.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { UpdateCabinDto, UpdateFlightDto } from './dto/manage-flight.dto';
import { airportLocalDateTime, airportLocalToUtc } from './local-date-time';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';

@Injectable()
export class FlightManagementService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
  ) {}

  async update(user: UserDocument, id: string, dto: UpdateFlightDto) {
    if (!Object.keys(dto).length)
      throw new BadRequestException(
        'Provide flight times or airports to change.',
      );
    const event = new Types.ObjectId().toString();
    return this.transaction(async (session) => {
      const flight = await this.lockScheduled(user, id, session);
      const departureId =
        dto.departureAirportId ?? flight.departureAirportId.toString();
      const arrivalId =
        dto.arrivalAirportId ?? flight.arrivalAirportId.toString();
      if (departureId.toLowerCase() === arrivalId.toLowerCase())
        throw new BadRequestException(
          'Arrival and departure airports must differ.',
        );
      const changedAirports =
        departureId.toLowerCase() !== flight.departureAirportId.toString() ||
        arrivalId.toLowerCase() !== flight.arrivalAirportId.toString();
      if (
        changedAirports &&
        (await this.bookings
          .exists({ 'segments.flightId': flight._id })
          .session(session))
      )
        throw new ConflictException(
          'Airports cannot change after any booking exists.',
        );
      // Sequential operations inside a MongoDB transaction.
      const departure = await this.airports
        .findById(departureId)
        .session(session)
        .exec();
      const arrival = await this.airports
        .findById(arrivalId)
        .session(session)
        .exec();
      if (!departure || !arrival)
        throw new BadRequestException(
          'Select both airports from the predefined airport list.',
        );
      const departureAt =
        dto.departureLocalDateTime === undefined
          ? flight.departureAt
          : airportLocalToUtc(dto.departureLocalDateTime, departure.timeZone);
      const arrivalAt =
        dto.arrivalLocalDateTime === undefined
          ? flight.arrivalAt
          : airportLocalToUtc(dto.arrivalLocalDateTime, arrival.timeZone);
      if (departureAt <= new Date())
        throw new BadRequestException('Departure must be in the future.');
      if (arrivalAt <= departureAt)
        throw new BadRequestException(
          'Arrival must be after departure, compared in UTC.',
        );
      const timeChanged =
        departureAt.getTime() !== flight.departureAt.getTime() ||
        arrivalAt.getTime() !== flight.arrivalAt.getTime();
      flight.departureAirportId = departure._id;
      flight.arrivalAirportId = arrival._id;
      flight.departureAt = departureAt;
      flight.arrivalAt = arrivalAt;
      flight.departureLocalDate = airportLocalDateTime(
        departureAt,
        departure.timeZone,
      ).slice(0, 10);
      await flight.save({ session });
      if (timeChanged) {
        const affected = await this.bookings
          .find({
            'segments.flightId': flight._id,
            status: BookingStatus.CONFIRMED,
          })
          .select('userId')
          .session(session)
          .exec();
        const owners = new Map(
          affected.map((booking) => [
            booking.userId.toString(),
            booking.userId,
          ]),
        );
        for (const recipientId of owners.values())
          await new this.notifications({
            recipientId,
            type: NotificationType.FLIGHT_SCHEDULE_CHANGED,
            subjectModel: Flight.name,
            subjectId: flight._id,
            title: 'Flight schedule changed',
            message: `Flight ${flight.flightNumber} now departs ${airportLocalDateTime(departureAt, departure.timeZone)} (${departure.timeZone}) and arrives ${airportLocalDateTime(arrivalAt, arrival.timeZone)} (${arrival.timeZone}).`,
            eventKey: `flight-time:${event}`,
          }).save({ session });
      }
      return Object.assign(flight.toObject(), {
        departureLocalDateTime: airportLocalDateTime(
          departureAt,
          departure.timeZone,
        ),
        arrivalLocalDateTime: airportLocalDateTime(arrivalAt, arrival.timeZone),
        departureTimeZone: departure.timeZone,
        arrivalTimeZone: arrival.timeZone,
      });
    });
  }

  async addCabin(user: UserDocument, id: string, dto: CreateCabinDto) {
    return this.transaction(async (session) => {
      const flight = await this.lockScheduled(user, id, session);
      const cabin = await new this.cabins({
        flightId: flight._id,
        cabinClass: dto.cabinClass,
        totalSeats: dto.totalSeats,
        priceMinorUnits: dto.priceMinorUnits,
        freeBagCount: dto.freeBagCount,
        maxBagWeightKg: dto.maxBagWeightKg,
        heldSeats: 0,
        bookedSeats: 0,
      }).save({ session });
      return Object.assign(cabin.toObject(), {
        seatsRemaining: cabin.totalSeats,
      });
    });
  }

  async updateCabin(
    user: UserDocument,
    id: string,
    cabinId: string,
    dto: UpdateCabinDto,
  ) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('Provide cabin values to change.');
    return this.transaction(async (session) => {
      const flight = await this.lockScheduled(user, id, session);
      if (
        !Types.ObjectId.isValid(cabinId) ||
        !(await this.cabins
          .exists({ _id: cabinId, flightId: flight._id })
          .session(session))
      )
        throw new NotFoundException('Cabin not found for this flight.');
      // Capacity is guarded in the write, including against concurrent holds.
      const cabin = await this.cabins
        .findOneAndUpdate(
          {
            _id: cabinId,
            flightId: flight._id,
            $expr: {
              $lte: [
                { $add: ['$bookedSeats', '$heldSeats'] },
                dto.totalSeats ?? '$totalSeats',
              ],
            },
          },
          { $set: Object.assign({}, dto) },
          { session, returnDocument: 'after', runValidators: true },
        )
        .exec();
      if (!cabin)
        throw new ConflictException(
          'Seat count cannot be below seats already booked or held.',
        );
      return Object.assign(cabin.toObject(), {
        seatsRemaining: cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
      });
    });
  }

  async cancel(user: UserDocument, id: string) {
    return this.transaction(async (session) => {
      const flight = await this.lockScheduled(user, id, session);
      flight.status = FlightStatus.CANCELLED;
      await flight.save({ session });
      const bookings = await this.bookings
        .find({
          'segments.flightId': flight._id,
          status: {
            $in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
          },
        })
        .session(session)
        .exec();
      let cancelledBookings = 0;
      let expiredHolds = 0;
      let pendingRefunds = 0;
      for (const booking of bookings) {
        const confirmed = booking.status === BookingStatus.CONFIRMED;
        // Cancel the whole round-trip booking and release both legs.
        for (const [index, segment] of booking.segments.entries()) {
          const seats = booking.passengers.filter(
            (p) => p.segments[index].type !== PassengerType.INFANT,
          ).length;
          const counter = confirmed ? 'bookedSeats' : 'heldSeats';
          const released = await this.cabins
            .updateOne(
              {
                _id: segment.cabinInventoryId,
                flightId: segment.flightId,
                [counter]: { $gte: seats },
              },
              { $inc: { [counter]: -seats } },
              { session },
            )
            .exec();
          if (released.matchedCount !== 1)
            throw new ConflictException(
              'Booking inventory is inconsistent; cancellation was rolled back.',
            );
        }
        if (confirmed) {
          const payment = await this.payments
            .findOne({
              bookingModel: 'FlightBooking',
              bookingId: booking._id,
              status: PaymentStatus.SUCCEEDED,
            })
            .session(session)
            .exec();
          if (
            !payment ||
            payment.amountMinorUnits !== booking.totalMinorUnits ||
            payment.currency !== booking.currency
          )
            throw new ConflictException(
              'A successful full booking payment is required to queue the refund.',
            );
          let refund = await this.refunds
            .findOne({ paymentId: payment._id })
            .session(session)
            .exec();
          if (
            refund &&
            (refund.amountMinorUnits !== payment.amountMinorUnits ||
              refund.currency !== payment.currency)
          )
            throw new ConflictException(
              'An existing refund needs reconciliation before cancellation.',
            );
          if (!refund)
            refund = await new this.refunds({
              paymentId: payment._id,
              amountMinorUnits: payment.amountMinorUnits,
              currency: payment.currency,
              status: RefundStatus.PENDING,
            }).save({ session });
          if (refund.status === RefundStatus.FAILED) {
            refund.status = RefundStatus.PENDING;
            await refund.save({ session });
          }
          // TODO(PAY-03): Phase 9 dispatcher sends pending refunds to Stripe
          // with idempotency, updates status and notifies. Never mark paid here.
          if (refund.status === RefundStatus.PENDING) pendingRefunds++;
          cancelledBookings++;
        } else {
          expiredHolds++;
          await this.payments
            .updateMany(
              {
                bookingModel: 'FlightBooking',
                bookingId: booking._id,
                status: PaymentStatus.PENDING,
              },
              { $set: { status: PaymentStatus.CANCELLED } },
              { session },
            )
            .exec();
          // PAY-01: Phase 9 must also cancel the Stripe intent and reject a
          // late payment webhook for an expired/cancelled booking.
        }
        await this.bookings
          .updateOne(
            { _id: booking._id, status: booking.status },
            {
              $set: {
                status: confirmed
                  ? BookingStatus.CANCELLED
                  : BookingStatus.EXPIRED,
              },
            },
            { session },
          )
          .exec();
        await new this.notifications({
          recipientId: booking.userId,
          type: NotificationType.BOOKING_CANCELLED,
          subjectModel: FlightBooking.name,
          subjectId: booking._id,
          title: 'Flight booking cancelled',
          message: confirmed
            ? `Flight ${flight.flightNumber} was cancelled. Your whole booking is cancelled with a 100% refund due; refund processing may still be pending.`
            : `Flight ${flight.flightNumber} was cancelled. Your whole booking hold has expired and its seats were released.`,
          eventKey: `flight-cancel:${booking._id.toString()}`,
        }).save({ session });
      }
      return {
        flightId: flight.id,
        status: FlightStatus.CANCELLED,
        cancelledBookings,
        expiredHolds,
        pendingRefunds,
      };
    });
  }

  /**
   * Writes the flight as a transaction fence. Phase 6 booking/hold creation
   * must conditionally write this same flight document in its transaction
   * before changing inventory, so it serializes with edits/cancellation.
   */
  private async lockScheduled(
    user: UserDocument,
    id: string,
    session: ClientSession,
  ) {
    const existing = Types.ObjectId.isValid(id)
      ? await this.flights.findById(id).session(session).exec()
      : null;
    if (!existing) throw new NotFoundException('Flight not found.');
    assertManagesProvider(user, ProviderType.AIRLINE, existing.airlineId);
    const locked = await this.flights
      .findOneAndUpdate(
        {
          _id: existing._id,
          status: FlightStatus.SCHEDULED,
          departureAt: { $gt: new Date() },
        },
        { $inc: { __v: 1 } },
        { session, returnDocument: 'after' },
      )
      .exec();
    if (!locked)
      throw new ConflictException(
        'Only a scheduled future flight can be changed or cancelled.',
      );
    return locked;
  }

  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.connection.transaction(work);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw new ConflictException(
          'This flight date/number or cabin class already exists.',
        );
      throw error;
    }
  }
}
