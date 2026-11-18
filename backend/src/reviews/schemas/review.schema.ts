import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { HotelBooking } from '../../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../../hotels/schemas/hotel.schema';
import { User } from '../../users/schemas/user.schema';

@Schema({ timestamps: true })
export class Review {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: HotelBooking.name,
    required: true,
    unique: true,
  })
  bookingId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Hotel.name,
    required: true,
  })
  hotelId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5, validate: Number.isInteger })
  rating: number;

  @Prop({ type: String, trim: true, maxlength: 1000 })
  body?: string;

  @Prop({ type: Date })
  hiddenAt?: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ hotelId: 1, hiddenAt: 1, createdAt: -1 });
