import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export enum FavouriteType {
  HOTEL = 'hotel',
  ITINERARY = 'itinerary',
}

/** BON-02 (optional): a hotel or public itinerary a traveler saved. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Favourite {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: FavouriteType, required: true })
  type: FavouriteType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId: Types.ObjectId;
}

export const FavouriteSchema = SchemaFactory.createForClass(Favourite);
// Each item can be saved once per user.
FavouriteSchema.index({ userId: 1, type: 1, targetId: 1 }, { unique: true });
FavouriteSchema.index({ userId: 1, createdAt: -1 });
