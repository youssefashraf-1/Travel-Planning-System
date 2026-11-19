import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { BookingStatus } from '../common/booking-status';
import { CabinInventory } from '../flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../flights/schemas/flight.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { newBookingReference, takesSeat } from './flight-booking-rules';
import { FlightBooking } from './schemas/flight-booking.schema';

type BookingSeats = Pick<FlightBooking, 'segments' | 'passengers'>;

/** Seats a booking takes on each segment; infants take none (FLT-12). */
export function seatsPerSegment(booking: BookingSeats): number[] {
  return booking.segments.map(
    (_segment, index) =>
      booking.passengers.filter((passenger) =>
        takesSeat(passenger.segments[index].type),
      ).length,
  );
}

/**
 * The parts of the GEN-11 lifecycle that happen without a traveler request:
 * holds expire after 10 minutes (FLT-22), paid holds become Confirmed
 * (FLT-23) and finished trips become Completed.
 */
@Injectable()
export class FlightBookingLifecycleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FlightBookingLifecycleService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  /**
   * FLT-22: a hold whose 10 minutes passed becomes Expired and its seats
   * return to the cabin. Each booking changes in its own transaction, and
   * the status check makes retries and parallel sweeps release seats once.
   */
  async expireDueHolds(
    now = new Date(),
    filter: QueryFilter<FlightBooking> = {},
  ): Promise<number> {
    const due = await this.bookings
      .find({
        ...filter,
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .limit(200)
      .lean()
      .exec();

    let expired = 0;
    for (const { _id } of due) {
      const changed = await this.connection.transaction(async (session) => {
        const booking = await this.bookings
          .findOneAndUpdate(
            {
              _id,
              status: BookingStatus.PENDING_PAYMENT,
              holdExpiresAt: { $lte: now },
            },
            { $set: { status: BookingStatus.EXPIRED } },
            { session, returnDocument: 'before' },
          )
          .exec();
        if (!booking) return false;
        await this.moveSeats(booking, session, { heldSeats: -1 });
        // PAY-01: the payment service must also cancel the Stripe intent and
        // refuse a late success for this booking.
        await this.payments
          .updateMany(
            {
              bookingModel: 'FlightBooking' as const,
              bookingId: booking._id,
              status: PaymentStatus.PENDING,
            },
            { $set: { status: PaymentStatus.CANCELLED } },
            { session },
          )
          .exec();
        return true;
      });
      if (changed) expired++;
    }
    return expired;
  }

  /** GEN-11: a confirmed booking is Completed once every flight has landed. */
  async completeFinished(now = new Date()): Promise<number> {
    const finished = await this.bookings
      .aggregate<{ _id: Types.ObjectId }>([
        { $match: { status: BookingStatus.CONFIRMED } },
        {
          $lookup: {
            from: this.flights.collection.name,
            localField: 'segments.flightId',
            foreignField: '_id',
            as: 'flights',
          },
        },
        {
          $match: {
            $expr: {
              $and: [
                { $gt: [{ $size: '$flights' }, 0] },
                {
                  $allElementsTrue: {
                    $map: {
                      input: '$flights',
                      in: { $lte: ['$$this.arrivalAt', now] },
                    },
                  },
                },
              ],
            },
          },
        },
        { $project: { _id: 1 } },
      ])
      .exec();
    if (finished.length === 0) return 0;
    const result = await this.bookings
      .updateMany(
        {
          _id: { $in: finished.map(({ _id }) => _id) },
          status: BookingStatus.CONFIRMED,
        },
        { $set: { status: BookingStatus.COMPLETED } },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * FLT-23: called by the payment service once Stripe confirms payment
   * (PAY-01). The hold must still be valid and the policies accepted
   * (PAY-02). Held seats become booked seats, a unique reference is set and
   * the traveler is notified. Pass the payment's session to confirm in the
   * same transaction that records the payment.
   */
  async confirmPaidBooking(
    bookingId: Types.ObjectId | string,
    options: { session?: ClientSession; now?: Date } = {},
  ) {
    const now = options.now ?? new Date();
    const work = async (session: ClientSession) => {
      const booking = Types.ObjectId.isValid(bookingId)
        ? await this.bookings.findById(bookingId).session(session).exec()
        : null;
      if (!booking) throw new NotFoundException('Booking not found.');
      if (booking.status !== BookingStatus.PENDING_PAYMENT)
        throw new ConflictException(
          'Only a booking waiting for payment can be confirmed.',
        );
      if (booking.holdExpiresAt <= now)
        throw new ConflictException('The seat hold has expired.');
      if (!booking.policyAcceptedAt)
        throw new ConflictException(
          'The booking policies must be accepted before payment (PAY-02).',
        );

      const flights = await this.lockFlights(
        booking.segments.map((segment) => segment.flightId),
        now,
        session,
      );
      await this.moveSeats(booking, session, { heldSeats: -1, bookedSeats: 1 });

      booking.status = BookingStatus.CONFIRMED;
      booking.reference = await this.uniqueReference(session);
      await booking.save({ session });

      const flightNumbers = booking.segments
        .map((segment) => flights.get(segment.flightId.toString()))
        .join(' and ');
      await new this.notifications({
        recipientId: booking.userId,
        type: NotificationType.BOOKING_CONFIRMED,
        subjectModel: FlightBooking.name,
        subjectId: booking._id,
        title: 'Flight booking confirmed',
        message: `Your booking ${booking.reference} for flight ${flightNumbers} is confirmed. Your e-ticket is ready to download.`,
        eventKey: `flight-booking-confirmed:${booking._id.toString()}`,
      }).save({ session });
      return booking;
    };
    return options.session
      ? work(options.session)
      : this.connection.transaction(work);
  }

  /**
   * Phase 5 contract: writing each scheduled, future flight inside the
   * transaction serializes bookings with flight edits and cancellation.
   * Flights are locked in id order to avoid deadlocks. Returns flight
   * numbers by id.
   */
  async lockFlights(
    flightIds: Types.ObjectId[],
    now: Date,
    session: ClientSession,
  ): Promise<Map<string, string>> {
    const numbers = new Map<string, string>();
    const ordered = [...flightIds].sort((a, b) =>
      a.toString().localeCompare(b.toString()),
    );
    for (const flightId of ordered) {
      const flight = await this.flights
        .findOneAndUpdate(
          {
            _id: flightId,
            status: FlightStatus.SCHEDULED,
            departureAt: { $gt: now },
          },
          { $inc: { __v: 1 } },
          { session, returnDocument: 'after' },
        )
        .exec();
      if (!flight)
        throw new ConflictException(
          'A flight in this booking is no longer open for booking.',
        );
      numbers.set(flightId.toString(), flight.flightNumber);
    }
    return numbers;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      await this.expireDueHolds();
      await this.completeFinished();
    } catch {
      this.logger.error('Unable to update flight booking statuses.');
    }
  }

  /** Adds `seats × factor` to each listed counter on every segment's cabin. */
  private async moveSeats(
    booking: BookingSeats,
    session: ClientSession,
    factors: Partial<Record<'heldSeats' | 'bookedSeats', number>>,
  ): Promise<void> {
    const seats = seatsPerSegment(booking);
    for (const [index, segment] of booking.segments.entries()) {
      const change = Object.fromEntries(
        Object.entries(factors).map(([counter, factor]) => [
          counter,
          seats[index] * factor,
        ]),
      );
      // Never let a counter go below zero; a mismatch rolls everything back.
      const guards = Object.fromEntries(
        Object.entries(change)
          .filter(([, amount]) => amount < 0)
          .map(([counter, amount]) => [counter, { $gte: -amount }]),
      );
      const result = await this.cabins
        .updateOne(
          {
            _id: segment.cabinInventoryId,
            flightId: segment.flightId,
            ...guards,
          },
          { $inc: change },
          { session },
        )
        .exec();
      if (result.matchedCount !== 1)
        throw new ConflictException(
          'Seat counts are inconsistent; the change was rolled back.',
        );
    }
  }

  private async uniqueReference(session: ClientSession): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reference = newBookingReference();
      if (!(await this.bookings.exists({ reference }).session(session)))
        return reference;
    }
    throw new ConflictException('Could not create a booking reference.');
  }
}
