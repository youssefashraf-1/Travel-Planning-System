import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/booking-status';
import { User } from '../../users/schemas/user.schema';

export enum ChangeRefundStatus {
  NONE = 'none',
  PENDING = 'pending',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

/**
 * FLT-27 (optional): moving one flight of a confirmed booking to another
 * flight on the same route and cabin. A higher fare is paid like a booking
 * (Pending Payment with a 10-minute seat hold, then Confirmed); a lower fare
 * is refunded on the original payment.
 */
@Schema({ timestamps: true })
export class FlightChange {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
  })
  bookingId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  /** 0 = outbound, 1 = return. */
  @Prop({ required: true, min: 0, max: 1 })
  legIndex: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  fromFlightId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  fromCabinInventoryId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  toFlightId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  toCabinInventoryId: Types.ObjectId;

  @Prop({ required: true, min: 0 }) seatsBefore: number;
  @Prop({ required: true, min: 0 }) seatsAfter: number;

  /** The booking segment and passenger prices to apply on completion. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  newSegment: Record<string, unknown>;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true })
  newPassengerSegments: Record<string, unknown>[];

  @Prop({ required: true }) oldSegmentTotalMinorUnits: number;
  @Prop({ required: true }) newSegmentTotalMinorUnits: number;

  @Prop({ type: String, enum: BookingStatus, required: true })
  status: BookingStatus;

  @Prop({ type: Date, required: true }) holdExpiresAt: Date;

  /** Set at request time: the traveler accepted the new flight's terms. */
  @Prop({ type: Date, required: true }) policyAcceptedAt: Date;

  @Prop({ required: true, uppercase: true, match: /^[A-Z]{3}$/ })
  currency: string;

  /** The amount to pay for a higher fare; 0 when nothing is due. */
  @Prop({ required: true, min: 0 }) totalMinorUnits: number;

  /** A lower fare's difference, refunded on the original payment. */
  @Prop({ required: true, default: 0, min: 0 }) refundMinorUnits: number;

  @Prop({
    type: String,
    enum: ChangeRefundStatus,
    default: ChangeRefundStatus.NONE,
  })
  refundStatus: ChangeRefundStatus;

  @Prop({ type: String }) stripeRefundId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  refundPaymentId?: Types.ObjectId;
}

export const FlightChangeSchema = SchemaFactory.createForClass(FlightChange);
FlightChangeSchema.index({ bookingId: 1, status: 1 });
FlightChangeSchema.index({ status: 1, holdExpiresAt: 1 });
FlightChangeSchema.index({ refundStatus: 1 });
