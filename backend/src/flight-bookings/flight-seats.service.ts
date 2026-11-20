import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertOwnedBy } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import {
  CabinClass,
  CabinInventory,
} from '../flights/schemas/cabin-inventory.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { FlightBookingDto } from './dto/flight-booking-response.dto';
import { FlightBookingsService } from './flight-bookings.service';
import { isSeatInCabin, seatLabels } from './seat-map';
import { FlightBooking } from './schemas/flight-booking.schema';
import { PassengerType } from './schemas/passenger.schema';
import { SeatAssignment } from './schemas/seat-assignment.schema';

const NOT_FOUND = 'Booking not found.';

type BookingForSeats = Pick<
  FlightBooking,
  'status' | 'holdExpiresAt' | 'segments'
>;

/** A seat stays taken only while its booking still uses that flight. */
export function seatIsTaken(
  assignment: Pick<SeatAssignment, 'flightId' | 'legIndex'>,
  booking: BookingForSeats | undefined,
  now: Date,
): boolean {
  if (!booking) return false;
  const active =
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.COMPLETED ||
    (booking.status === BookingStatus.PENDING_PAYMENT &&
      booking.holdExpiresAt > now);
  return (
    active &&
    !!booking.segments[assignment.legIndex]?.flightId.equals(
      assignment.flightId,
    )
  );
}

/** FLT-28 (optional): seat maps and choosing seats. */
@Injectable()
export class FlightSeatsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(SeatAssignment.name)
    private readonly assignments: Model<SeatAssignment>,
    private readonly flightBookings: FlightBookingsService,
  ) {}

  /** Every seat of one cabin, and whether it is free. */
  async seatMap(flightId: string, cabinClass: CabinClass, now = new Date()) {
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).lean().exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found.');
    const cabin = await this.cabins
      .findOne({ flightId: flight._id, cabinClass })
      .lean()
      .exec();
    if (!cabin)
      throw new NotFoundException(`This flight has no ${cabinClass} cabin.`);
    const taken = await this.takenSeats(cabin._id, now);
    const seats = seatLabels(cabin.cabinClass, cabin.totalSeats).map(
      (seat) => ({ seat, available: !taken.has(seat) }),
    );
    return {
      flightId: flight._id.toString(),
      flightNumber: flight.flightNumber,
      cabinClass: cabin.cabinClass,
      seats,
      availableCount: seats.filter((s) => s.available).length,
    };
  }

  /**
   * Picks a seat for one passenger on one flight of the traveler's own
   * held or confirmed booking, before departure. The unique index makes
   * a race for the same seat end with one winner.
   */
  async chooseSeat(
    user: UserDocument,
    bookingId: string,
    dto: { leg: 'outbound' | 'return'; passenger: number; seat: string },
    now = new Date(),
  ): Promise<FlightBookingDto> {
    const booking = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId).lean().exec()
      : null;
    if (!booking) throw new NotFoundException(NOT_FOUND);
    assertOwnedBy(user, booking.userId, NOT_FOUND);
    const active =
      booking.status === BookingStatus.CONFIRMED ||
      (booking.status === BookingStatus.PENDING_PAYMENT &&
        booking.holdExpiresAt > now);
    if (!active)
      throw new ConflictException(
        'Seats can be chosen for held or confirmed bookings only.',
      );
    const legIndex = dto.leg === 'outbound' ? 0 : 1;
    const segment = booking.segments[legIndex];
    if (!segment)
      throw new BadRequestException('This booking has no return flight.');
    const passengerIndex = dto.passenger - 1;
    const passenger = booking.passengers[passengerIndex];
    if (!passenger)
      throw new BadRequestException(
        `passenger must be between 1 and ${booking.passengers.length}.`,
      );
    if (passenger.segments[legIndex].type === PassengerType.INFANT)
      throw new BadRequestException(
        "Infants sit on an adult's lap and do not get a seat.",
      );
    const [flight, cabin] = await Promise.all([
      this.flights.findById(segment.flightId).lean().exec(),
      this.cabins.findById(segment.cabinInventoryId).lean().exec(),
    ]);
    if (!flight || flight.departureAt <= now)
      throw new ConflictException('This flight has already departed.');
    const seat = dto.seat.toUpperCase();
    if (!cabin || !isSeatInCabin(seat, cabin.cabinClass, cabin.totalSeats))
      throw new BadRequestException(
        `Seat ${seat} does not exist in this ${segment.cabinClass} cabin.`,
      );

    if (passenger.segments[legIndex].seat !== seat) {
      await this.claim(
        cabin._id,
        flight._id,
        seat,
        booking._id,
        legIndex,
        passengerIndex,
        now,
      );
      await this.assignments
        .deleteMany({
          bookingId: booking._id,
          legIndex,
          passengerIndex,
          seat: { $ne: seat },
        })
        .exec();
      await this.bookings
        .updateOne(
          { _id: booking._id },
          {
            $set: {
              [`passengers.${passengerIndex}.segments.${legIndex}.seat`]: seat,
            },
          },
        )
        .exec();
    }
    return this.flightBookings.details(user, bookingId, now);
  }

  private async claim(
    cabinInventoryId: Types.ObjectId,
    flightId: Types.ObjectId,
    seat: string,
    bookingId: Types.ObjectId,
    legIndex: number,
    passengerIndex: number,
    now: Date,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.assignments.create({
          flightId,
          cabinInventoryId,
          seat,
          bookingId,
          legIndex,
          passengerIndex,
        });
        return;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const existing = await this.assignments
          .findOne({ cabinInventoryId, seat })
          .lean()
          .exec();
        if (!existing) continue;
        const owner = await this.bookings
          .findById(existing.bookingId)
          .select('status holdExpiresAt segments.flightId')
          .lean()
          .exec();
        if (seatIsTaken(existing, owner ?? undefined, now))
          throw new ConflictException(`Seat ${seat} is already taken.`);
        // The old holder no longer uses this seat: free it and try again.
        await this.assignments.deleteOne({ _id: existing._id }).exec();
      }
    }
    throw new ConflictException(`Seat ${seat} is already taken.`);
  }

  private async takenSeats(
    cabinInventoryId: Types.ObjectId,
    now: Date,
  ): Promise<Set<string>> {
    const assignments = await this.assignments
      .find({ cabinInventoryId })
      .lean()
      .exec();
    const bookings = await this.bookings
      .find({ _id: { $in: assignments.map((a) => a.bookingId) } })
      .select('status holdExpiresAt segments.flightId')
      .lean()
      .exec();
    const byId = new Map(bookings.map((b) => [b._id.toString(), b]));
    return new Set(
      assignments
        .filter((a) => seatIsTaken(a, byId.get(a.bookingId.toString()), now))
        .map((a) => a.seat),
    );
  }
}
