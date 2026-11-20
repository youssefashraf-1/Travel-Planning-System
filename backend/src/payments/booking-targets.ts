import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { assertOwnedBy } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { FlightBookingLifecycleService } from '../flight-bookings/flight-booking-lifecycle.service';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBookingLifecycleService } from '../hotel-bookings/hotel-booking-lifecycle.service';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { BookingType } from './dto/payment.dto';

export type BookingModelName = 'FlightBooking' | 'HotelBooking';

export const MODEL_FOR: Record<BookingType, BookingModelName> = {
  [BookingType.FLIGHT]: 'FlightBooking',
  [BookingType.HOTEL]: 'HotelBooking',
};

export const TYPE_FOR: Record<BookingModelName, BookingType> = {
  FlightBooking: BookingType.FLIGHT,
  HotelBooking: BookingType.HOTEL,
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
 * service (FLT-23, HTL-17), so payments treat both the same way.
 */
@Injectable()
export class BookingTargets {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    private readonly flightLifecycle: FlightBookingLifecycleService,
    private readonly hotelLifecycle: HotelBookingLifecycleService,
  ) {}

  model(name: BookingModelName): Model<FlightBooking> | Model<HotelBooking> {
    return name === 'FlightBooking' ? this.flightBookings : this.hotelBookings;
  }

  async find(
    name: BookingModelName,
    id: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<PayableBooking | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const query =
      name === 'FlightBooking'
        ? this.flightBookings.findById(id)
        : this.hotelBookings.findById(id);
    return (await query
      .session(session ?? null)
      .lean()
      .exec()) as PayableBooking | null;
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
    const result =
      name === 'FlightBooking'
        ? await this.flightBookings.updateOne(filter, update).exec()
        : await this.hotelBookings.updateOne(filter, update).exec();
    return result.modifiedCount === 1;
  }
}
