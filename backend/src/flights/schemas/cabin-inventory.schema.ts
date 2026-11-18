import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Flight } from './flight.schema';

export enum CabinClass {
  ECONOMY = 'economy',
  PREMIUM_ECONOMY = 'premium_economy',
  BUSINESS = 'business',
  FIRST = 'first',
}

@Schema({ timestamps: true })
export class CabinInventory {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Flight.name,
    required: true,
  })
  flightId: Types.ObjectId;

  @Prop({ type: String, enum: CabinClass, required: true })
  cabinClass: CabinClass;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  totalSeats: number;

  @Prop({ required: true, default: 0, min: 0, validate: Number.isSafeInteger })
  heldSeats: number;

  @Prop({ required: true, default: 0, min: 0, validate: Number.isSafeInteger })
  bookedSeats: number;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  priceMinorUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  freeBagCount: number;

  @Prop({ required: true, min: Number.MIN_VALUE, validate: Number.isFinite })
  maxBagWeightKg: number;
}

export const CabinInventorySchema =
  SchemaFactory.createForClass(CabinInventory);

CabinInventorySchema.index({ flightId: 1, cabinClass: 1 }, { unique: true });

CabinInventorySchema.pre('validate', function () {
  if (this.heldSeats + this.bookedSeats > this.totalSeats) {
    this.invalidate(
      'totalSeats',
      'Capacity must cover all held and booked seats.',
    );
  }
});
