import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { FlightBooking } from '../../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../../hotel-bookings/schemas/hotel-booking.schema';
import { Currency } from '../../reference-data/schemas/currency.schema';

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({
    type: String,
    enum: [FlightBooking.name, HotelBooking.name],
    required: true,
  })
  bookingModel: 'FlightBooking' | 'HotelBooking';

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    refPath: 'bookingModel',
    required: true,
  })
  bookingId: Types.ObjectId;

  @Prop({ required: true, trim: true, unique: true })
  stripePaymentIntentId: string;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  amountMinorUnits: number;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    ref: Currency.name,
  })
  currency: string;

  @Prop({
    type: String,
    enum: PaymentStatus,
    required: true,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  /** Remote cancellation/success is verified, or a captured extra charge has a durable refund record. */
  @Prop({ type: Date })
  stripeReconciledAt?: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ bookingModel: 1, bookingId: 1, createdAt: -1 });
PaymentSchema.index(
  { bookingModel: 1, bookingId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: PaymentStatus.SUCCEEDED },
  },
);
