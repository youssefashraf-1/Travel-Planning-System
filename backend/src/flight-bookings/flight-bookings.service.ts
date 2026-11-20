import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../airports/schemas/airport.schema';
import { assertOwnedBy } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { PLATFORM_CURRENCY } from '../common/currency';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { airportLocalDateTime } from '../flights/local-date-time';
import {
  CabinClass,
  CabinInventory,
} from '../flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../flights/schemas/flight.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../payments/schemas/refund.schema';
import { UserDocument } from '../users/schemas/user.schema';
import {
  BookingPassengerDto,
  FlightBookingRequestDto,
} from './dto/flight-booking-request.dto';
import {
  BookedSegmentDto,
  BookingGroup,
  CancelledFlightBookingDto,
  FlightBookingDto,
  FlightBookingListDto,
  FlightBookingSummaryDto,
  ListFlightBookingsQueryDto,
} from './dto/flight-booking-response.dto';
import {
  FlightBookingLifecycleService,
  seatsPerSegment,
} from './flight-booking-lifecycle.service';
import {
  HOLD_MINUTES,
  passengerFare,
  passengerTypeOn,
  refundAmount,
  refundPercentage,
  takesSeat,
} from './flight-booking-rules';
import { FlightBooking } from './schemas/flight-booking.schema';
import { PassengerType } from './schemas/passenger.schema';

type Leg = 'outbound' | 'return';
type WithId<T> = T & { _id: Types.ObjectId };

interface PlannedLeg {
  leg: Leg;
  flight: WithId<Flight>;
  airline: WithId<Airline>;
  cabin: WithId<CabinInventory>;
  departure: WithId<Airport>;
  arrival: WithId<Airport>;
  seats: number;
}

interface PlannedPassenger {
  fullName: string;
  dateOfBirth: string;
  passportOrIdNumber: string;
  segments: {
    type: PassengerType;
    fareMinorUnits: number;
    extraBagWeightsKg: number[];
    baggageFeeMinorUnits: number;
  }[];
}

interface BookingPlan {
  legs: PlannedLeg[];
  passengers: PlannedPassenger[];
  faresMinorUnits: number;
  baggageFeesMinorUnits: number;
  totalMinorUnits: number;
}

type StoredBooking = WithId<FlightBooking> & {
  createdAt?: Date;
  updatedAt?: Date;
};

const LEGS: Leg[] = ['outbound', 'return'];
const NOT_FOUND = 'Booking not found.';

/** Shows only the last four characters of a passport or ID number. */
export function maskDocumentNumber(value: string | undefined): string {
  if (!value) return '••••';
  return value.length <= 4
    ? '•'.repeat(value.length)
    : '•'.repeat(value.length - 4) + value.slice(-4);
}

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    private readonly lifecycle: FlightBookingLifecycleService,
  ) {}

  /** FLT-19, FLT-21: validate the request and show what it would cost. */
  async quote(
    dto: FlightBookingRequestDto,
    now = new Date(),
  ): Promise<FlightBookingSummaryDto> {
    await this.releaseStaleHolds(dto, now);
    const plan = await this.plan(dto, now);
    return this.presentPlan(plan);
  }

  /**
   * FLT-22: reserve the seats for 10 minutes and create a Pending Payment
   * booking, all in one transaction. The seat check and the increment are
   * a single conditional write, so simultaneous requests can never take more
   * seats than remain.
   */
  async hold(
    user: UserDocument,
    dto: FlightBookingRequestDto,
    now = new Date(),
  ): Promise<FlightBookingDto> {
    // ACC-02: travelers verify their email address before booking.
    if (user.emailVerified === false)
      throw new ForbiddenException(
        'Verify your email address before booking. Use the link we emailed you, or request a new one with POST /api/auth/resend-verification.',
      );

    await this.releaseStaleHolds(dto, now);
    const bookingId = await this.connection.transaction(async (session) => {
      const plan = await this.plan(dto, now, session);
      // ACC-15: serialize new holds against provider deactivation, in id order.
      const airlineIds = [
        ...new Set(plan.legs.map((leg) => leg.airline._id.toString())),
      ].sort((a, b) => a.localeCompare(b));
      for (const id of airlineIds) {
        const locked = await this.airlines
          .updateOne(
            { _id: id, isActive: true },
            { $inc: { __v: 1 } },
            { session, timestamps: false },
          )
          .exec();
        if (locked.matchedCount !== 1)
          throw new ConflictException(
            'An airline is no longer taking bookings.',
          );
      }
      await this.lifecycle.lockFlights(
        plan.legs.map((leg) => leg.flight._id),
        now,
        session,
      );
      for (const leg of plan.legs) {
        const reserved = await this.cabins
          .findOneAndUpdate(
            {
              _id: leg.cabin._id,
              flightId: leg.flight._id,
              $expr: {
                $gte: [
                  {
                    $subtract: [
                      '$totalSeats',
                      { $add: ['$bookedSeats', '$heldSeats'] },
                    ],
                  },
                  leg.seats,
                ],
              },
            },
            { $inc: { heldSeats: leg.seats } },
            { session, returnDocument: 'after' },
          )
          .exec();
        if (!reserved)
          throw new ConflictException(
            `Not enough ${leg.cabin.cabinClass} seats are left on flight ${leg.flight.flightNumber}.`,
          );
      }

      const [booking] = await this.bookings.create(
        [
          {
            userId: user._id,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
            currency: PLATFORM_CURRENCY,
            totalMinorUnits: plan.totalMinorUnits,
            segments: plan.legs.map((leg) => ({
              flightId: leg.flight._id,
              cabinInventoryId: leg.cabin._id,
              airlineId: leg.airline._id,
              cabinClass: leg.cabin.cabinClass,
              cabinFareMinorUnits: leg.cabin.priceMinorUnits,
              freeBagCount: leg.cabin.freeBagCount,
              maxBagWeightKg: leg.cabin.maxBagWeightKg,
              extraBaggagePolicy: leg.airline.extraBaggagePolicy,
              cancellationTiers: leg.airline.cancellationTiers,
            })),
            passengers: plan.passengers,
          },
        ],
        { session },
      );
      return booking._id;
    });
    return this.details(user, bookingId.toString(), now);
  }

  /** FLT-25: the signed-in traveler's bookings in one group. */
  async list(
    user: UserDocument,
    query: ListFlightBookingsQueryDto,
    now = new Date(),
  ): Promise<FlightBookingListDto> {
    await this.lifecycle.expireDueHolds(now, { userId: user._id });
    const group = query.group ?? BookingGroup.UPCOMING;
    const page = query.page ?? 1;

    const byGroup: Record<
      BookingGroup,
      { match: Record<string, unknown>; sort: Record<string, 1 | -1> }
    > = {
      [BookingGroup.UPCOMING]: {
        match: {
          status: {
            $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
          },
          departureAt: { $gt: now },
        },
        sort: { departureAt: 1, _id: 1 },
      },
      [BookingGroup.PAST]: {
        match: {
          $or: [
            { status: BookingStatus.COMPLETED },
            { status: BookingStatus.CONFIRMED, departureAt: { $lte: now } },
          ],
        },
        sort: { departureAt: -1, _id: -1 },
      },
      [BookingGroup.CANCELLED]: {
        match: {
          status: { $in: [BookingStatus.CANCELLED, BookingStatus.EXPIRED] },
        },
        sort: { updatedAt: -1, _id: -1 },
      },
    };

    const pipeline: PipelineStage[] = [
      { $match: { userId: user._id } },
      {
        $addFields: {
          outboundFlightId: { $arrayElemAt: ['$segments.flightId', 0] },
        },
      },
      {
        $lookup: {
          from: this.flights.collection.name,
          localField: 'outboundFlightId',
          foreignField: '_id',
          as: 'outbound',
        },
      },
      {
        $addFields: {
          departureAt: { $arrayElemAt: ['$outbound.departureAt', 0] },
        },
      },
      { $match: byGroup[group].match },
      { $sort: byGroup[group].sort },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * PAGE_SIZE },
            { $limit: PAGE_SIZE },
            // Aggregation ignores select: false, so drop documents here.
            {
              $project: {
                'passengers.passportOrIdNumber': 0,
                outbound: 0,
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];
    const [result] = await this.bookings
      .aggregate<{
        items: StoredBooking[];
        total: { count: number }[];
      }>(pipeline)
      .exec();
    const segmentViews = await this.segmentViews(result.items);

    const { totalItems, totalPages, pageSize } = pageInfo(
      page,
      result.total[0]?.count ?? 0,
    );
    return {
      group,
      page,
      pageSize,
      totalItems,
      totalPages,
      items: result.items.map((booking) => ({
        id: booking._id.toString(),
        reference: booking.reference,
        status: booking.status,
        tripType: booking.segments.length === 2 ? 'round_trip' : 'one_way',
        segments: segmentViews(booking),
        passengerCount: booking.passengers.length,
        totalMinorUnits: booking.totalMinorUnits,
        currency: booking.currency,
        holdExpiresAt:
          booking.status === BookingStatus.PENDING_PAYMENT
            ? booking.holdExpiresAt
            : undefined,
      })),
    };
  }

  /** FLT-25: full details of one of the traveler's own bookings. */
  async details(
    user: UserDocument,
    id: string,
    now = new Date(),
  ): Promise<FlightBookingDto> {
    const booking = await this.findOwn(user, id, now);
    const segmentViews = await this.segmentViews([booking]);
    const segments = segmentViews(booking);
    const fares = booking.passengers
      .flatMap((passenger) => passenger.segments)
      .reduce((sum, selection) => sum + selection.fareMinorUnits, 0);

    return {
      id: booking._id.toString(),
      reference: booking.reference,
      status: booking.status,
      tripType: booking.segments.length === 2 ? 'round_trip' : 'one_way',
      segments,
      passengers: booking.passengers.map((passenger) => ({
        fullName: passenger.fullName,
        dateOfBirth: passenger.dateOfBirth,
        passportOrIdNumber: maskDocumentNumber(passenger.passportOrIdNumber),
        segments: passenger.segments.map((selection, index) => ({
          leg: LEGS[index],
          type: selection.type,
          fareMinorUnits: selection.fareMinorUnits,
          extraBagWeightsKg: selection.extraBagWeightsKg,
          baggageFeeMinorUnits: selection.baggageFeeMinorUnits,
        })),
      })),
      faresMinorUnits: fares,
      baggageFeesMinorUnits: booking.totalMinorUnits - fares,
      totalMinorUnits: booking.totalMinorUnits,
      currency: booking.currency,
      cancellationTiers: booking.segments[0].cancellationTiers.map((tier) => ({
        daysBeforeDeparture: tier.daysBeforeDeparture,
        refundPercentage: tier.refundPercentage,
      })),
      holdExpiresAt: booking.holdExpiresAt,
      policyAcceptedAt: booking.policyAcceptedAt,
      cancellation:
        booking.status === BookingStatus.CONFIRMED
          ? this.cancellationQuote(booking, segments[0].departureAt, now)
          : undefined,
      refund: await this.refundFor(booking._id),
      createdAt: booking.createdAt as Date,
    };
  }

  /**
   * FLT-26: cancel a confirmed booking before its outbound flight leaves.
   * Both legs are cancelled together, seats return to inventory, and the
   * refund follows the outbound airline's tiers (FLT-09, FLT-12a).
   */
  async cancel(
    user: UserDocument,
    id: string,
    now = new Date(),
  ): Promise<CancelledFlightBookingDto> {
    return this.connection.transaction(async (session) => {
      const booking = await this.loadOwn(user, id, session);
      if (booking.status !== BookingStatus.CONFIRMED)
        throw new ConflictException(
          'Only a confirmed booking can be cancelled.',
        );
      const outbound = await this.flights
        .findById(booking.segments[0].flightId)
        .session(session)
        .lean()
        .exec();
      if (!outbound || outbound.departureAt <= now)
        throw new ConflictException(
          'The outbound flight has departed, so this booking can no longer be cancelled.',
        );

      const changed = await this.bookings
        .updateOne(
          { _id: booking._id, status: BookingStatus.CONFIRMED },
          { $set: { status: BookingStatus.CANCELLED } },
          { session },
        )
        .exec();
      if (changed.modifiedCount !== 1)
        throw new ConflictException('This booking was already changed.');

      const seats = seatsPerSegment(booking);
      for (const [index, segment] of booking.segments.entries()) {
        const released = await this.cabins
          .updateOne(
            {
              _id: segment.cabinInventoryId,
              bookedSeats: { $gte: seats[index] },
            },
            { $inc: { bookedSeats: -seats[index] } },
            { session },
          )
          .exec();
        if (released.matchedCount !== 1)
          throw new ConflictException(
            'Seat counts are inconsistent; the cancellation was rolled back.',
          );
      }

      const { refundPercentage: percentage, refundMinorUnits } =
        this.cancellationQuote(booking, outbound.departureAt, now);
      if (refundMinorUnits > 0) {
        const payment = await this.payments
          .findOne({
            bookingModel: 'FlightBooking' as const,
            bookingId: booking._id,
            status: PaymentStatus.SUCCEEDED,
          })
          .session(session)
          .exec();
        if (!payment)
          throw new ConflictException(
            'No successful payment was found for this booking, so the refund cannot be recorded.',
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
              amountMinorUnits: refundMinorUnits,
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
            subjectModel: FlightBooking.name,
            subjectId: booking._id,
            title: 'Flight booking cancelled',
            message:
              refundMinorUnits > 0
                ? `Your booking ${booking.reference} was cancelled. A refund of ${percentage}% (${refundMinorUnits} ${booking.currency} minor units) is being processed.`
                : `Your booking ${booking.reference} was cancelled. No refund is due under the airline's cancellation policy.`,
            eventKey: `flight-booking-cancelled:${booking._id.toString()}`,
          },
        ],
        { session },
      );

      return {
        id: booking._id.toString(),
        status: BookingStatus.CANCELLED,
        refundPercentage: percentage,
        refundMinorUnits,
        currency: booking.currency,
        refundStatus: refundMinorUnits > 0 ? 'pending' : 'none',
      };
    });
  }

  /** The booking for the e-ticket, which only exists once it is paid. */
  async ticket(user: UserDocument, id: string, now = new Date()) {
    const details = await this.details(user, id, now);
    if (
      details.status !== BookingStatus.CONFIRMED &&
      details.status !== BookingStatus.COMPLETED
    )
      throw new ConflictException(
        'An e-ticket is available once the booking is confirmed.',
      );
    return details;
  }

  private cancellationQuote(
    booking: Pick<FlightBooking, 'segments' | 'totalMinorUnits'>,
    outboundDepartureAt: Date,
    now: Date,
  ) {
    const allowed = outboundDepartureAt > now;
    const percentage = allowed
      ? refundPercentage(
          booking.segments[0].cancellationTiers,
          outboundDepartureAt,
          now,
        )
      : 0;
    return {
      allowed,
      refundPercentage: percentage,
      refundMinorUnits: refundAmount(booking.totalMinorUnits, percentage),
    };
  }

  /** Builds and checks a booking from current flights, cabins and policies. */
  private async plan(
    dto: FlightBookingRequestDto,
    now: Date,
    session?: ClientSession,
  ): Promise<BookingPlan> {
    if (!dto.returnFlightId && dto.returnCabinClass)
      throw new BadRequestException('returnCabinClass needs a returnFlightId.');
    if (dto.returnFlightId === dto.outboundFlightId)
      throw new BadRequestException('Outbound and return flights must differ.');
    if (
      !dto.returnFlightId &&
      dto.passengers.some((p) => p.returnExtraBagWeightsKg?.length)
    )
      throw new BadRequestException('Return extra bags need a return flight.');

    const requested: { leg: Leg; flightId: string; cabinClass: CabinClass }[] =
      [
        {
          leg: 'outbound',
          flightId: dto.outboundFlightId,
          cabinClass: dto.outboundCabinClass,
        },
      ];
    if (dto.returnFlightId)
      requested.push({
        leg: 'return',
        flightId: dto.returnFlightId,
        cabinClass: dto.returnCabinClass ?? dto.outboundCabinClass,
      });

    const legs: Omit<PlannedLeg, 'seats'>[] = [];
    for (const { leg, flightId, cabinClass } of requested) {
      const flight = await this.flights
        .findById(flightId)
        .session(session ?? null)
        .lean()
        .exec();
      if (!flight)
        throw new NotFoundException(`The ${leg} flight was not found.`);
      if (flight.status !== FlightStatus.SCHEDULED || flight.departureAt <= now)
        throw new ConflictException(
          `Flight ${flight.flightNumber} is no longer open for booking.`,
        );
      const airline = await this.airlines
        .findById(flight.airlineId)
        .session(session ?? null)
        .lean()
        .exec();
      if (!airline?.isActive)
        throw new ConflictException(
          `Flight ${flight.flightNumber} cannot be booked because its airline is not taking bookings.`,
        );
      const cabin = await this.cabins
        .findOne({ flightId: flight._id, cabinClass })
        .session(session ?? null)
        .lean()
        .exec();
      if (!cabin)
        throw new NotFoundException(
          `Flight ${flight.flightNumber} has no ${cabinClass} cabin.`,
        );
      const [departure, arrival] = await Promise.all(
        [flight.departureAirportId, flight.arrivalAirportId].map((airportId) =>
          this.airports
            .findById(airportId)
            .session(session ?? null)
            .lean()
            .exec(),
        ),
      );
      if (!departure || !arrival)
        throw new ConflictException(
          `Flight ${flight.flightNumber} has an unknown airport.`,
        );
      legs.push({ leg, flight, airline, cabin, departure, arrival });
    }

    if (legs.length === 2) {
      const [outbound, back] = legs.map((leg) => leg.flight);
      if (
        !back.departureAirportId.equals(outbound.arrivalAirportId) ||
        !back.arrivalAirportId.equals(outbound.departureAirportId)
      )
        throw new BadRequestException(
          'The return flight must fly the reverse route of the outbound flight.',
        );
      if (back.departureAt <= outbound.arrivalAt)
        throw new BadRequestException(
          'The return flight must leave after the outbound flight lands.',
        );
    }

    const today = now.toISOString().slice(0, 10);
    const passengers = dto.passengers.map((passenger, index) =>
      this.planPassenger(passenger, index + 1, legs, today),
    );

    const planned = legs.map((leg, index) => {
      const types = passengers.map((p) => p.segments[index].type);
      const adults = types.filter(
        (type) => type === PassengerType.ADULT,
      ).length;
      const infants = types.filter(
        (type) => type === PassengerType.INFANT,
      ).length;
      if (adults === 0)
        throw new BadRequestException(
          `Flight ${leg.flight.flightNumber} needs at least one adult passenger (12 or older).`,
        );
      if (infants > adults)
        throw new BadRequestException(
          `Flight ${leg.flight.flightNumber} can have at most one infant per adult.`,
        );
      const seats = types.filter(takesSeat).length;
      const left =
        leg.cabin.totalSeats - leg.cabin.bookedSeats - leg.cabin.heldSeats;
      if (left < seats)
        throw new ConflictException(
          `Only ${Math.max(left, 0)} ${leg.cabin.cabinClass} seats are left on flight ${leg.flight.flightNumber}.`,
        );
      return { ...leg, seats };
    });

    const selections = passengers.flatMap((p) => p.segments);
    const fares = selections.reduce((sum, s) => sum + s.fareMinorUnits, 0);
    const fees = selections.reduce((sum, s) => sum + s.baggageFeeMinorUnits, 0);
    return {
      legs: planned,
      passengers,
      faresMinorUnits: fares,
      baggageFeesMinorUnits: fees,
      totalMinorUnits: fares + fees,
    };
  }

  private planPassenger(
    passenger: BookingPassengerDto,
    number: number,
    legs: Omit<PlannedLeg, 'seats'>[],
    today: string,
  ): PlannedPassenger {
    if (passenger.dateOfBirth > today)
      throw new BadRequestException(
        `Passenger ${number}'s date of birth is in the future.`,
      );
    const segments = legs.map((leg) => {
      const flightDate = leg.flight.departureLocalDate;
      if (passenger.dateOfBirth > flightDate)
        throw new BadRequestException(
          `Passenger ${number} is born after flight ${leg.flight.flightNumber}.`,
        );
      const type = passengerTypeOn(passenger.dateOfBirth, flightDate);
      if (leg.leg === 'outbound' && type !== passenger.type)
        throw new BadRequestException(
          `Passenger ${number} is entered as ${passenger.type} but is ${type === PassengerType.ADULT ? 'an' : 'a'} ${type} on the outbound flight date (adult 12+, child 2–11, infant under 2).`,
        );

      const weights =
        (leg.leg === 'outbound'
          ? passenger.outboundExtraBagWeightsKg
          : passenger.returnExtraBagWeightsKg) ?? [];
      const policy = leg.airline.extraBaggagePolicy;
      const maxBags = policy?.maxExtraBagsPerPassenger ?? 0;
      if (weights.length > maxBags)
        throw new BadRequestException(
          maxBags === 0
            ? `${leg.airline.name} does not sell extra bags on flight ${leg.flight.flightNumber}.`
            : `Passenger ${number} can add at most ${maxBags} extra bags on flight ${leg.flight.flightNumber}.`,
        );
      if (weights.some((kg) => kg <= 0 || kg > leg.cabin.maxBagWeightKg))
        throw new BadRequestException(
          `Each extra bag on flight ${leg.flight.flightNumber} must weigh more than 0 and at most ${leg.cabin.maxBagWeightKg} kg.`,
        );

      return {
        type,
        fareMinorUnits: passengerFare(type, leg.cabin.priceMinorUnits),
        extraBagWeightsKg: weights,
        baggageFeeMinorUnits:
          weights.length * (policy?.pricePerBagMinorUnits ?? 0),
      };
    });
    return {
      fullName: passenger.fullName,
      dateOfBirth: passenger.dateOfBirth,
      passportOrIdNumber: passenger.passportOrIdNumber,
      segments,
    };
  }

  private presentPlan(plan: BookingPlan): FlightBookingSummaryDto {
    return {
      tripType: plan.legs.length === 2 ? 'round_trip' : 'one_way',
      segments: plan.legs.map((leg) =>
        this.presentSegment(
          leg.leg,
          leg.flight,
          leg.airline,
          leg.departure,
          leg.arrival,
          {
            cabinClass: leg.cabin.cabinClass,
            cabinFareMinorUnits: leg.cabin.priceMinorUnits,
            freeBagCount: leg.cabin.freeBagCount,
            maxBagWeightKg: leg.cabin.maxBagWeightKg,
            extraBaggagePolicy: leg.airline.extraBaggagePolicy,
            seats: leg.seats,
          },
        ),
      ),
      passengers: plan.passengers.map((passenger) => ({
        fullName: passenger.fullName,
        dateOfBirth: passenger.dateOfBirth,
        passportOrIdNumber: maskDocumentNumber(passenger.passportOrIdNumber),
        segments: passenger.segments.map((selection, index) => ({
          leg: LEGS[index],
          ...selection,
        })),
      })),
      faresMinorUnits: plan.faresMinorUnits,
      baggageFeesMinorUnits: plan.baggageFeesMinorUnits,
      totalMinorUnits: plan.totalMinorUnits,
      currency: PLATFORM_CURRENCY,
      cancellationTiers: plan.legs[0].airline.cancellationTiers.map((tier) => ({
        daysBeforeDeparture: tier.daysBeforeDeparture,
        refundPercentage: tier.refundPercentage,
      })),
    };
  }

  private presentSegment(
    leg: Leg,
    flight: WithId<Flight>,
    airline: Pick<Airline, 'name'> | undefined,
    departure: Pick<Airport, 'iataCode' | 'name' | 'timeZone'>,
    arrival: Pick<Airport, 'iataCode' | 'name' | 'timeZone'>,
    terms: {
      cabinClass: BookedSegmentDto['cabinClass'];
      cabinFareMinorUnits: number;
      freeBagCount: number;
      maxBagWeightKg: number;
      extraBaggagePolicy?: Airline['extraBaggagePolicy'];
      seats: number;
    },
  ): BookedSegmentDto {
    const airport = (a: typeof departure) => ({
      iataCode: a.iataCode,
      name: a.name,
      timeZone: a.timeZone,
    });
    return {
      leg,
      flightId: flight._id.toString(),
      flightNumber: flight.flightNumber,
      airlineName: airline?.name ?? 'Unknown airline',
      departureAirport: airport(departure),
      arrivalAirport: airport(arrival),
      departureLocalDateTime: airportLocalDateTime(
        flight.departureAt,
        departure.timeZone,
      ),
      arrivalLocalDateTime: airportLocalDateTime(
        flight.arrivalAt,
        arrival.timeZone,
      ),
      departureAt: flight.departureAt,
      arrivalAt: flight.arrivalAt,
      durationMinutes: Math.round(
        (flight.arrivalAt.getTime() - flight.departureAt.getTime()) / 60_000,
      ),
      cabinClass: terms.cabinClass,
      cabinFareMinorUnits: terms.cabinFareMinorUnits,
      freeBagCount: terms.freeBagCount,
      maxBagWeightKg: terms.maxBagWeightKg,
      pricePerExtraBagMinorUnits:
        terms.extraBaggagePolicy?.pricePerBagMinorUnits,
      maxExtraBagsPerPassenger:
        terms.extraBaggagePolicy?.maxExtraBagsPerPassenger ?? 0,
      seats: terms.seats,
    };
  }

  /**
   * Loads the flights, airlines and airports for stored bookings in a few
   * queries, and returns a function that presents one booking's segments
   * with current flight times and the booked terms.
   */
  private async segmentViews(bookings: StoredBooking[]) {
    const flightIds = bookings.flatMap((b) =>
      b.segments.map((s) => s.flightId),
    );
    const flights = await this.flights
      .find({ _id: { $in: flightIds } })
      .lean()
      .exec();
    const flightById = new Map(flights.map((f) => [f._id.toString(), f]));
    const [airlines, airports] = await Promise.all([
      this.airlines
        .find({ _id: { $in: flights.map((f) => f.airlineId) } })
        .select('name')
        .lean()
        .exec(),
      this.airports
        .find({
          _id: {
            $in: flights.flatMap((f) => [
              f.departureAirportId,
              f.arrivalAirportId,
            ]),
          },
        })
        .lean()
        .exec(),
    ]);
    const airlineById = new Map(airlines.map((a) => [a._id.toString(), a]));
    const airportById = new Map(airports.map((a) => [a._id.toString(), a]));
    const unknownAirport = {
      iataCode: '???',
      name: 'Unknown',
      timeZone: 'UTC',
    };

    return (booking: StoredBooking): BookedSegmentDto[] => {
      const seats = seatsPerSegment(booking);
      return booking.segments.flatMap((segment, index) => {
        const flight = flightById.get(segment.flightId.toString());
        if (!flight) return [];
        return [
          this.presentSegment(
            LEGS[index],
            flight,
            airlineById.get(flight.airlineId.toString()),
            airportById.get(flight.departureAirportId.toString()) ??
              unknownAirport,
            airportById.get(flight.arrivalAirportId.toString()) ??
              unknownAirport,
            {
              cabinClass: segment.cabinClass,
              cabinFareMinorUnits: segment.cabinFareMinorUnits,
              freeBagCount: segment.freeBagCount,
              maxBagWeightKg: segment.maxBagWeightKg,
              extraBaggagePolicy: segment.extraBaggagePolicy,
              seats: seats[index],
            },
          ),
        ];
      });
    };
  }

  /** The traveler's own booking, with an overdue hold expired first. */
  private async findOwn(
    user: UserDocument,
    id: string,
    now: Date,
  ): Promise<StoredBooking> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(NOT_FOUND);
    await this.lifecycle.expireDueHolds(now, {
      _id: new Types.ObjectId(id),
      userId: user._id,
    });
    const booking = await this.bookings
      .findById(id)
      .select('+passengers.passportOrIdNumber')
      .lean()
      .exec();
    if (!booking) throw new NotFoundException(NOT_FOUND);
    assertOwnedBy(user, booking.userId, NOT_FOUND);
    return booking as StoredBooking;
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

  /** Frees seats from overdue holds on these flights before counting. */
  private async releaseStaleHolds(dto: FlightBookingRequestDto, now: Date) {
    const flightIds = [dto.outboundFlightId, dto.returnFlightId]
      .filter((id): id is string => !!id && Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    await this.lifecycle.expireDueHolds(now, {
      'segments.flightId': { $in: flightIds },
    });
  }

  /** PAY-03: the refund of this booking's successful payment, if any. */
  private async refundFor(bookingId: Types.ObjectId) {
    const payment = await this.payments
      .findOne({
        bookingModel: 'FlightBooking' as const,
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
