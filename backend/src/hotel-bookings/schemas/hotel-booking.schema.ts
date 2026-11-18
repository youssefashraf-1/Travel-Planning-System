import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus, wasConfirmed } from '../../common/booking-status';
import { isCalendarDate } from '../../common/validation/calendar-date';
import { isIanaTimeZone } from '../../common/validation/local-time';
import {
  HotelPolicy,
  HotelPolicySchema,
} from '../../hotels/schemas/hotel-policy.schema';
import { Hotel } from '../../hotels/schemas/hotel.schema';
import { Room } from '../../hotels/schemas/room.schema';
import { User } from '../../users/schemas/user.schema';
import { Currency } from '../../reference-data/schemas/currency.schema';

@Schema({ _id: false })
class ReservedRoom {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Room.name, required: true })
  roomId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  maxOccupancy: number;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  nightlyPriceMinorUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  adults: number;

  @Prop({
    type: [
      {
        type: Number,
        required: true,
        min: 0,
        max: 17,
        validate: Number.isInteger,
      },
    ],
    default: [],
    required: true,
    castNonArrays: false,
  })
  childAges: number[];
}

const ReservedRoomSchema = SchemaFactory.createForClass(ReservedRoom);

@Schema({ timestamps: true })
export class HotelBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Hotel.name,
    required: true,
  })
  hotelId: Types.ObjectId;

  @Prop({ required: true, validate: isCalendarDate })
  checkInDate: string;

  @Prop({ required: true, validate: isCalendarDate })
  checkOutDate: string;

  @Prop({ required: true, trim: true, validate: isIanaTimeZone })
  timeZone: string;

  @Prop({
    type: [ReservedRoomSchema],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (rooms: (ReservedRoom | null)[]) =>
        rooms.length > 0 && rooms.every(Boolean),
      message: 'Select at least one room.',
    },
  })
  rooms: ReservedRoom[];

  @Prop({
    type: String,
    enum: BookingStatus,
    required: true,
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  @Prop({ type: String, trim: true, uppercase: true, required: wasConfirmed })
  reference?: string;

  @Prop({ type: Date, required: true })
  holdExpiresAt: Date;

  @Prop({ type: HotelPolicySchema, required: true })
  policy: HotelPolicy;

  @Prop({ type: Date, required: wasConfirmed })
  policyAcceptedAt?: Date;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    ref: Currency.name,
  })
  currency: string;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  totalMinorUnits: number;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);

HotelBookingSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
HotelBookingSchema.index({ userId: 1, createdAt: -1 });
HotelBookingSchema.index({ hotelId: 1, checkInDate: 1 });
HotelBookingSchema.index({
  'rooms.roomId': 1,
  status: 1,
  checkInDate: 1,
  checkOutDate: 1,
});
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });

HotelBookingSchema.pre('validate', function () {
  if (!isCalendarDate(this.checkInDate) || !isCalendarDate(this.checkOutDate)) {
    return;
  }

  if (this.checkOutDate <= this.checkInDate) {
    this.invalidate('checkOutDate', 'Check-out must be after check-in.');
    return;
  }

  if (!this.rooms?.length || this.rooms.some((room) => !room || !room.roomId)) {
    return;
  }

  const roomIds = new Set(this.rooms.map((room) => room.roomId.toString()));
  if (roomIds.size !== this.rooms.length) {
    this.invalidate(
      'rooms',
      'Each room can be reserved only once per booking.',
    );
  }

  if (!this.rooms.some((room) => room.adults > 0)) {
    this.invalidate('rooms', 'A reservation needs at least one adult.');
  }

  const exceedsOccupancy = this.rooms.some((room) => {
    const guestCount = room.adults + (room.childAges?.length ?? 0);
    return guestCount < 1 || guestCount > room.maxOccupancy;
  });
  if (exceedsOccupancy) {
    this.invalidate(
      'rooms',
      'Assign at least one guest to each room without exceeding occupancy.',
    );
  }

  // Date-only strings parse at UTC midnight, so daylight saving changes do not alter the night count.
  const nights =
    (Date.parse(this.checkOutDate) - Date.parse(this.checkInDate)) / 86_400_000;
  const nightlyTotal = this.rooms.reduce(
    (total, room) => total + room.nightlyPriceMinorUnits,
    0,
  );
  if (nights * nightlyTotal !== this.totalMinorUnits) {
    this.invalidate(
      'totalMinorUnits',
      'The total must match the booked room prices and number of nights.',
    );
  }
});
