import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Hotel } from './hotel.schema';

@Schema({ timestamps: true })
export class Room {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Hotel.name,
    required: true,
  })
  hotelId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ required: true, trim: true })
  roomType: string;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  bedCount: number;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  maxOccupancy: number;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  nightlyPriceMinorUnits: number;

  @Prop({ required: true, default: true })
  isActive: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);

RoomSchema.index(
  { hotelId: 1, label: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
RoomSchema.index({ hotelId: 1, isActive: 1 });
