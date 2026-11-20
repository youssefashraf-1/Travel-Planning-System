import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { assertOwnedBy } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { FlightBookingLifecycleService } from '../flight-bookings/flight-booking-lifecycle.service';
import { FlightChangesService } from '../flight-bookings/flight-changes.service';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { FlightChange } from '../flight-bookings/schemas/flight-change.schema';
import { HotelBookingLifecycleService } from '../hotel-bookings/hotel-booking-lifecycle.service';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { BookingType } from './dto/payment.dto';

export type BookingModelName =
  'FlightBooking' | 'HotelBooking' | 'FlightChange';

export const MODEL_FOR: Record<BookingType, BookingModelName> = {
  [BookingType.FLIGHT]: 'FlightBooking',
  [BookingType.HOTEL]: 'HotelBooking',
  [BookingType.FLIGHT_CHANGE]: 'FlightChange',
};

export const TYPE_FOR: Record<BookingModelName, BookingType> = {
  FlightBooking: BookingType.FLIGHT,
  HotelBooking: BookingType.HOTEL,
  FlightChange: BookingType.FLIGHT_CHANGE,
};

/** The fields payments need, shared by flight and hotel bookings. */
export interface PayableBooking {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: BookingStatus;
  reference?: string;
  holdExpiresAt: Date;
  policyAcceptedAt?: Date;
  currency: string;
  totalMinorUnits: number;
}

/**
 * Loads either kind of booking and confirms it through its own lifecycle
 * service (FLT-23, HTL-17), so payments treat both the same way. A flight
 * change with a higher fare (FLT-27) is paid the same way as a booking.
 */
@Injectable()
export class BookingTargets {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(FlightChange.name)
    private readonly flightChanges: Model<FlightChange>,
    private readonly flightLifecycle: FlightBookingLifecycleService,
    private readonly hotelLifecycle: HotelBookingLifecycleService,
    private readonly changes: FlightChangesService,
  ) {}

  async find(
    name: BookingModelName,
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<PayableBooking | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const s = session ?? null;
    const found =
      name === 'FlightBooking'
        ? await this.flightBookings.findById(id).session(s).lean().exec()
        : name === 'HotelBooking'
          ? await this.hotelBookings.findById(id).session(s).lean().exec()
          : await this.flightChanges.findById(id).session(s).lean().exec();
    return found as PayableBooking | null;
  }

  /** The signed-in traveler's own booking; anyone else gets 404 (ACC-11). */
  async findOwn(
    user: UserDocument,
    name: BookingModelName,
    id: string,
  ): Promise<PayableBooking> {
    const booking = await this.find(name, id);
    if (!booking) throw new NotFoundException('Booking not found.');
    assertOwnedBy(user, booking.userId, 'Booking not found.');
    return booking;
  }

  /** Throws Conflict or NotFound when the booking can no longer be confirmed. */
  confirm(
    name: BookingModelName,
    id: Types.ObjectId,
    options: { session: ClientSession; now: Date },
  ) {
    if (name === 'FlightChange') return this.changes.completePaid(id, options);
    return name === 'FlightBooking'
      ? this.flightLifecycle.confirmPaidBooking(id, options)
      : this.hotelLifecycle.confirmPaidReservation(id, options);
  }

  async acceptPolicies(
    name: BookingModelName,
    id: Types.ObjectId,
    now: Date,
  ): Promise<boolean> {
    const filter = {
      _id: id,
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: { $gt: now },
    };
    const update = { $set: { policyAcceptedAt: now } };
    // A flight change records the acceptance when it is requested.
    if (name === 'FlightChange') return false;
    const result =
      name === 'FlightBooking'
        ? await this.flightBookings.updateOne(filter, update).exec()
        : await this.hotelBookings.updateOne(filter, update).exec();
    return result.modifiedCount === 1;
  }
}
