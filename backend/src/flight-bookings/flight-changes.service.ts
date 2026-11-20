import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { assertOwnedBy } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { CabinInventory } from '../flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../flights/schemas/flight.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { refundStatusOf } from '../payments/refund-status';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { RefundStatus } from '../payments/schemas/refund.schema';
import { StripeGateway } from '../payments/stripe-gateway';
import { UserDocument } from '../users/schemas/user.schema';
import { FlightBookingDto } from './dto/flight-booking-response.dto';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import {
  HOLD_MINUTES,
  passengerFare,
  passengerTypeOn,
  takesSeat,
} from './flight-booking-rules';
import { FlightBookingsService } from './flight-bookings.service';
import {
  ChangeRefundStatus,
  FlightChange,
} from './schemas/flight-change.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { PassengerType } from './schemas/passenger.schema';

const NOT_FOUND = 'Booking not found.';

export interface ChangeFlightResult {
  preview: boolean;
  changeId?: string;
  status: 'quote' | 'confirmed' | 'pending_payment';
  leg: 'outbound' | 'return';
  fromFlightId: string;
  toFlightId: string;
  oldSegmentTotalMinorUnits: number;
  newSegmentTotalMinorUnits: number;
  fareDifferenceMinorUnits: number;
  amountDueMinorUnits: number;
  refundMinorUnits: number;
  currency: string;
  holdExpiresAt?: Date;
  nextStep: string;
  booking: FlightBookingDto;
}

/**
 * FLT-27 (optional): change one flight of a confirmed booking to another
 * flight on the same route and cabin, before it departs.
 * - Same or lower total: changed at once; the difference is refunded on
 *   the original payment through Stripe.
 * - Higher total: the new seats are held for 10 minutes while the traveler
 *   pays the difference (POST /api/payments with bookingType
 *   "flight_change"); the change completes when Stripe confirms.
 */
@Injectable()
export class FlightChangesService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(FlightChangesService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(FlightChange.name)
    private readonly changes: Model<FlightChange>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    private readonly lifecycle: FlightBookingLifecycleService,
    private readonly flightBookings: FlightBookingsService,
    private readonly stripe: StripeGateway,
  ) {}

  async change(
    user: UserDocument,
    bookingId: string,
    dto: {
      leg: 'outbound' | 'return';
      newFlightId: string;
      previewOnly?: boolean;
    },
    now = new Date(),
  ): Promise<ChangeFlightResult> {
    const legIndex = dto.leg === 'outbound' ? 0 : 1;
    const plan = await this.plan(
      user,
      bookingId,
      legIndex,
      dto.newFlightId,
      now,
    );
    const base = {
      leg: dto.leg,
      fromFlightId: plan.oldFlightId.toString(),
      toFlightId: plan.newFlight._id.toString(),
      oldSegmentTotalMinorUnits: plan.oldTotal,
      newSegmentTotalMinorUnits: plan.newTotal,
      fareDifferenceMinorUnits: plan.newTotal - plan.oldTotal,
      amountDueMinorUnits: Math.max(plan.newTotal - plan.oldTotal, 0),
      refundMinorUnits: Math.max(plan.oldTotal - plan.newTotal, 0),
      currency: plan.booking.currency,
    };
    if (dto.previewOnly)
      return {
        ...base,
        preview: true,
        status: 'quote',
        nextStep:
          'Send the same request without previewOnly to change the flight.',
        booking: await this.flightBookings.details(user, bookingId, now),
      };

    const change = await this.connection.transaction(async (session) => {
      if (
        await this.changes
          .exists({
            bookingId: plan.booking._id,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: now },
          })
          .session(session)
      )
        throw new ConflictException(
          'This booking already has a flight change waiting for payment.',
        );
      await this.lifecycle.lockFlights(
        [plan.oldFlightId, plan.newFlight._id],
        now,
        session,
      );
      const payDifference = base.amountDueMinorUnits > 0;
      // Reserve the new seats: held while the difference is paid, booked
      // right away otherwise.
      await this.takeSeats(
        plan.newCabinId,
        plan.seatsAfter,
        payDifference ? 'heldSeats' : 'bookedSeats',
        session,
      );
      let refundPaymentId: Types.ObjectId | undefined;
      if (base.refundMinorUnits > 0)
        refundPaymentId = await this.refundSource(
          plan.booking._id,
          base.refundMinorUnits,
          session,
        );
      const [created] = await this.changes.create(
        [
          {
            bookingId: plan.booking._id,
            userId: user._id,
            legIndex,
            fromFlightId: plan.oldFlightId,
            fromCabinInventoryId: plan.oldCabinId,
            toFlightId: plan.newFlight._id,
            toCabinInventoryId: plan.newCabinId,
            seatsBefore: plan.seatsBefore,
            seatsAfter: plan.seatsAfter,
            newSegment: plan.newSegment,
            newPassengerSegments: plan.newPassengerSegments,
            oldSegmentTotalMinorUnits: plan.oldTotal,
            newSegmentTotalMinorUnits: plan.newTotal,
            status: payDifference
              ? BookingStatus.PENDING_PAYMENT
              : BookingStatus.CONFIRMED,
            holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
            policyAcceptedAt: now,
            currency: plan.booking.currency,
            totalMinorUnits: base.amountDueMinorUnits,
            refundMinorUnits: base.refundMinorUnits,
            refundStatus:
              base.refundMinorUnits > 0
                ? ChangeRefundStatus.PENDING
                : ChangeRefundStatus.NONE,
            refundPaymentId,
          },
        ],
        { session },
      );
      if (!payDifference) await this.apply(created, session);
      return created;
    });
    if (change.refundStatus === ChangeRefundStatus.PENDING)
      await this.sendRefund(change._id).catch(() => undefined);

    const pending = change.status === BookingStatus.PENDING_PAYMENT;
    return {
      ...base,
      preview: false,
      changeId: change._id.toString(),
      status: pending ? 'pending_payment' : 'confirmed',
      holdExpiresAt: pending ? change.holdExpiresAt : undefined,
      nextStep: pending
        ? `Pay ${base.amountDueMinorUnits} ${base.currency} minor units within ${HOLD_MINUTES} minutes: POST /api/payments with { "bookingType": "flight_change", "bookingId": "${change._id.toString()}" }.`
        : base.refundMinorUnits > 0
          ? 'The flight is changed. The fare difference is being refunded to your card.'
          : 'The flight is changed.',
      booking: await this.flightBookings.details(user, bookingId, now),
    };
  }

  /**
   * Called by the payment service when Stripe confirms the fare difference.
   * Throws Conflict when the change can no longer be applied, so the
   * payment is refunded instead.
   */
  async completePaid(
    changeId: Types.ObjectId | string,
    options: { session: ClientSession; now: Date },
  ) {
    const { session, now } = options;
    const change = await this.changes
      .findById(changeId)
      .session(session)
      .exec();
    if (!change) throw new NotFoundException('Flight change not found.');
    if (change.status !== BookingStatus.PENDING_PAYMENT)
      throw new ConflictException(
        'Only a flight change waiting for payment can be completed.',
      );
    if (change.holdExpiresAt <= now)
      throw new ConflictException('The seat hold for this change has expired.');
    await this.lifecycle.lockFlights(
      [change.fromFlightId, change.toFlightId],
      now,
      session,
    );
    // The held seats become booked seats.
    const moved = await this.cabins
      .updateOne(
        {
          _id: change.toCabinInventoryId,
          heldSeats: { $gte: change.seatsAfter },
        },
        {
          $inc: {
            heldSeats: -change.seatsAfter,
            bookedSeats: change.seatsAfter,
          },
        },
        { session },
      )
      .exec();
    if (moved.matchedCount !== 1)
      throw new ConflictException(
        'Seat counts are inconsistent; nothing was changed.',
      );
    await this.apply(change, session);
    change.status = BookingStatus.CONFIRMED;
    await change.save({ session });
    return change;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<void> {
    try {
      await this.expireDueChanges(now);
      await this.dispatchRefunds();
    } catch {
      this.logger.error('Unable to update flight changes.');
    }
  }

  /** Ends unpaid change holds and returns their seats. */
  async expireDueChanges(now = new Date()): Promise<number> {
    const due = await this.changes
      .find({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .limit(200)
      .lean()
      .exec();
    let expired = 0;
    for (const { _id } of due) {
      const done = await this.connection.transaction(async (session) => {
        const change = await this.changes
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
        if (!change) return false;
        await this.cabins
          .updateOne(
            {
              _id: change.toCabinInventoryId,
              heldSeats: { $gte: change.seatsAfter },
            },
            { $inc: { heldSeats: -change.seatsAfter } },
            { session },
          )
          .exec();
        return true;
      });
      if (done) expired++;
    }
    return expired;
  }

  /** Sends lower-fare refunds to Stripe and follows them up. */
  async dispatchRefunds(): Promise<void> {
    const pending = await this.changes
      .find({
        refundStatus: ChangeRefundStatus.PENDING,
        status: BookingStatus.CONFIRMED,
      })
      .select('_id')
      .limit(100)
      .lean()
      .exec();
    for (const { _id } of pending)
      await this.sendRefund(_id).catch(() =>
        this.logger.error(`Could not refund flight change ${_id.toString()}.`),
      );
  }

  private async sendRefund(changeId: Types.ObjectId): Promise<void> {
    const change = await this.changes.findById(changeId).exec();
    if (!change || change.refundStatus !== ChangeRefundStatus.PENDING) return;
    const payment = await this.payments
      .findById(change.refundPaymentId)
      .lean()
      .exec();
    if (!payment) return;
    const state = change.stripeRefundId
      ? await this.stripe.retrieveRefund(change.stripeRefundId)
      : await this.stripe.createRefund({
          paymentIntentId: payment.stripePaymentIntentId,
          amountMinorUnits: change.refundMinorUnits,
          metadata: { flightChangeId: change._id.toString() },
          idempotencyKey: `flight-change-refund-${change._id.toString()}`,
        });
    const status = refundStatusOf(state);
    change.stripeRefundId = state.id;
    if (status === RefundStatus.REFUNDED)
      change.refundStatus = ChangeRefundStatus.REFUNDED;
    if (status === RefundStatus.FAILED)
      change.refundStatus = ChangeRefundStatus.FAILED;
    await change.save();
  }

  /** Moves the booking to the new flight and notifies the traveler. */
  private async apply(
    change: FlightChange & { _id: Types.ObjectId },
    session: ClientSession,
  ) {
    const leg = change.legIndex;
    // The old flight's seats return to inventory.
    const released = await this.cabins
      .updateOne(
        {
          _id: change.fromCabinInventoryId,
          bookedSeats: { $gte: change.seatsBefore },
        },
        { $inc: { bookedSeats: -change.seatsBefore } },
        { session },
      )
      .exec();
    if (released.matchedCount !== 1)
      throw new ConflictException(
        'Seat counts are inconsistent; nothing was changed.',
      );
    const booking = await this.bookings
      .findById(change.bookingId)
      .session(session)
      .exec();
    if (
      !booking ||
      booking.status !== BookingStatus.CONFIRMED ||
      !booking.segments[leg]?.flightId.equals(change.fromFlightId)
    )
      throw new ConflictException(
        'The booking changed in the meantime; nothing was changed.',
      );
    booking.set(`segments.${leg}`, change.newSegment);
    change.newPassengerSegments.forEach((selection, index) =>
      booking.set(`passengers.${index}.segments.${leg}`, selection),
    );
    booking.totalMinorUnits +=
      change.newSegmentTotalMinorUnits - change.oldSegmentTotalMinorUnits;
    await booking.save({ session });

    const flight = await this.flights
      .findById(change.toFlightId)
      .select('flightNumber departureLocalDate')
      .session(session)
      .lean()
      .exec();
    await this.notifications.create(
      [
        {
          recipientId: booking.userId,
          type: NotificationType.BOOKING_CONFIRMED,
          subjectModel: FlightBooking.name,
          subjectId: booking._id,
          title: 'Flight changed',
          message:
            `Your booking ${booking.reference} now uses flight ${flight?.flightNumber ?? ''} on ${flight?.departureLocalDate ?? ''}.` +
            (change.refundMinorUnits > 0
              ? ` ${change.refundMinorUnits} ${change.currency} minor units are being refunded.`
              : ''),
          eventKey: `flight-change:${change._id.toString()}`,
        },
      ],
      { session },
    );
  }

  private async takeSeats(
    cabinId: Types.ObjectId,
    seats: number,
    counter: 'heldSeats' | 'bookedSeats',
    session: ClientSession,
  ) {
    const taken = await this.cabins
      .findOneAndUpdate(
        {
          _id: cabinId,
          $expr: {
            $gte: [
              {
                $subtract: [
                  '$totalSeats',
                  { $add: ['$bookedSeats', '$heldSeats'] },
                ],
              },
              seats,
            ],
          },
        },
        { $inc: { [counter]: seats } },
        { session },
      )
      .exec();
    if (!taken)
      throw new ConflictException(
        'Not enough seats are left on the new flight.',
      );
  }

  /** The original payment, which must still cover the lower-fare refund. */
  private async refundSource(
    bookingId: Types.ObjectId,
    amount: number,
    session: ClientSession,
  ): Promise<Types.ObjectId> {
    const payment = await this.payments
      .findOne({
        bookingModel: 'FlightBooking',
        bookingId,
        status: PaymentStatus.SUCCEEDED,
      })
      .session(session)
      .lean()
      .exec();
    if (!payment)
      throw new ConflictException(
        'No successful payment was found for this booking, so the fare difference cannot be refunded.',
      );
    const earlier = await this.changes
      .find({
        refundPaymentId: payment._id,
        refundStatus: { $ne: ChangeRefundStatus.FAILED },
      })
      .session(session)
      .lean()
      .exec();
    const left =
      payment.amountMinorUnits -
      earlier.reduce((s, c) => s + c.refundMinorUnits, 0);
    if (left < amount)
      throw new ConflictException(
        'The original payment cannot cover this refund; the change needs reconciliation.',
      );
    return payment._id;
  }

  private async plan(
    user: UserDocument,
    bookingId: string,
    legIndex: number,
    newFlightId: string,
    now: Date,
  ) {
    const booking = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId).lean().exec()
      : null;
    if (!booking) throw new NotFoundException(NOT_FOUND);
    assertOwnedBy(user, booking.userId, NOT_FOUND);
    if (booking.status !== BookingStatus.CONFIRMED)
      throw new ConflictException('Only a confirmed booking can be changed.');
    const segment = booking.segments[legIndex];
    if (!segment)
      throw new BadRequestException('This booking has no return flight.');
    const [oldFlight, newFlight, other] = await Promise.all([
      this.flights.findById(segment.flightId).lean().exec(),
      Types.ObjectId.isValid(newFlightId)
        ? this.flights.findById(newFlightId).lean().exec()
        : null,
      booking.segments[1 - legIndex]
        ? this.flights
            .findById(booking.segments[1 - legIndex].flightId)
            .lean()
            .exec()
        : null,
    ]);
    if (!oldFlight || oldFlight.departureAt <= now)
      throw new ConflictException(
        'This flight has already departed, so it can no longer be changed.',
      );
    if (!newFlight)
      throw new NotFoundException('The new flight was not found.');
    if (newFlight._id.equals(oldFlight._id))
      throw new BadRequestException('Choose a different flight.');
    if (
      !newFlight.departureAirportId.equals(oldFlight.departureAirportId) ||
      !newFlight.arrivalAirportId.equals(oldFlight.arrivalAirportId)
    )
      throw new BadRequestException('The new flight must fly the same route.');
    if (
      newFlight.status !== FlightStatus.SCHEDULED ||
      newFlight.departureAt <= now
    )
      throw new ConflictException('The new flight is not open for booking.');
    if (other) {
      const ordered =
        legIndex === 0
          ? newFlight.arrivalAt < other.departureAt
          : newFlight.departureAt > other.arrivalAt;
      if (!ordered)
        throw new BadRequestException(
          'The outbound flight must land before the return flight leaves.',
        );
    }
    const [airline, newCabin] = await Promise.all([
      this.airlines.findById(newFlight.airlineId).lean().exec(),
      this.cabins
        .findOne({ flightId: newFlight._id, cabinClass: segment.cabinClass })
        .lean()
        .exec(),
    ]);
    if (!airline?.isActive)
      throw new ConflictException(
        'The new flight’s airline is not taking bookings.',
      );
    if (!newCabin)
      throw new NotFoundException(
        `The new flight has no ${segment.cabinClass} cabin (the cabin cannot change).`,
      );

    const policy = airline.extraBaggagePolicy;
    const newPassengerSegments = booking.passengers.map((passenger, index) => {
      const weights = passenger.segments[legIndex].extraBagWeightsKg ?? [];
      if (weights.length > (policy?.maxExtraBagsPerPassenger ?? 0))
        throw new BadRequestException(
          `Passenger ${index + 1}'s extra bags exceed the new airline's limit.`,
        );
      if (weights.some((kg) => kg > newCabin.maxBagWeightKg))
        throw new BadRequestException(
          `Passenger ${index + 1}'s extra bags exceed the new cabin's weight limit.`,
        );
      const type = passengerTypeOn(
        passenger.dateOfBirth,
        newFlight.departureLocalDate,
      );
      return {
        type,
        fareMinorUnits: passengerFare(type, newCabin.priceMinorUnits),
        extraBagWeightsKg: weights,
        baggageFeeMinorUnits:
          weights.length * (policy?.pricePerBagMinorUnits ?? 0),
      };
    });
    const types = newPassengerSegments.map((s) => s.type);
    const adults = types.filter((t) => t === PassengerType.ADULT).length;
    if (
      adults === 0 ||
      types.filter((t) => t === PassengerType.INFANT).length > adults
    )
      throw new BadRequestException(
        'On the new date the passengers need an adult and at most one infant per adult.',
      );
    const sum = (
      list: { fareMinorUnits: number; baggageFeeMinorUnits: number }[],
    ) =>
      list.reduce((s, x) => s + x.fareMinorUnits + x.baggageFeeMinorUnits, 0);
    const oldSelections = booking.passengers.map((p) => p.segments[legIndex]);
    const seatsBefore = oldSelections.filter((s) => takesSeat(s.type)).length;
    const seatsAfter = types.filter(takesSeat).length;
    if (
      newCabin.totalSeats - newCabin.bookedSeats - newCabin.heldSeats <
      seatsAfter
    )
      throw new ConflictException(
        'Not enough seats are left on the new flight.',
      );
    return {
      booking,
      oldFlightId: oldFlight._id,
      oldCabinId: segment.cabinInventoryId,
      newFlight,
      newCabinId: newCabin._id,
      seatsBefore,
      seatsAfter,
      oldTotal: sum(oldSelections),
      newTotal: sum(newPassengerSegments),
      newPassengerSegments,
      newSegment: {
        flightId: newFlight._id,
        cabinInventoryId: newCabin._id,
        airlineId: airline._id,
        cabinClass: newCabin.cabinClass,
        cabinFareMinorUnits: newCabin.priceMinorUnits,
        freeBagCount: newCabin.freeBagCount,
        maxBagWeightKg: newCabin.maxBagWeightKg,
        extraBaggagePolicy: airline.extraBaggagePolicy,
        cancellationTiers: airline.cancellationTiers,
      },
    };
  }
}
