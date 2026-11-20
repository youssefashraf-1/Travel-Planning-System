import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

/**
 * FLT-28 (optional): one chosen seat. The unique index on cabin and seat
 * means two passengers can never hold the same seat, even when they pick it
 * at the same moment. A seat whose booking expired, was cancelled or moved
 * to another flight counts as free again.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class SeatAssignment {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  flightId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cabinInventoryId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, match: /^\d{1,3}[A-K]$/ })
  seat: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
  })
  bookingId: Types.ObjectId;

  @Prop({ required: true, min: 0, max: 1 }) legIndex: number;
  @Prop({ required: true, min: 0 }) passengerIndex: number;
}

export const SeatAssignmentSchema =
  SchemaFactory.createForClass(SeatAssignment);
SeatAssignmentSchema.index({ cabinInventoryId: 1, seat: 1 }, { unique: true });
SeatAssignmentSchema.index({ bookingId: 1, legIndex: 1, passengerIndex: 1 });
