import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { isCalendarDate } from '../../common/validation/calendar-date';
import { Country } from '../../reference-data/schemas/country.schema';
import { User } from '../../users/schemas/user.schema';
import { ItineraryDay, ItineraryDaySchema } from './itinerary-day.schema';

export enum ItineraryVisibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

@Schema({ _id: false })
class ItineraryAttribution {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  sourceItineraryId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  originalAuthorId: Types.ObjectId;
}

const ItineraryAttributionSchema =
  SchemaFactory.createForClass(ItineraryAttribution);

@Schema({ timestamps: true, optimisticConcurrency: true })
export class Itinerary {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  title: string;

  @Prop({
    type: [
      {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        match: /^[A-Z]{2}$/,
        ref: Country.name,
      },
    ],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (codes: string[]) =>
        codes.length > 0 && new Set(codes).size === codes.length,
      message: 'Choose one or more distinct countries.',
    },
  })
  countryCodes: string[];

  @Prop({ required: true, validate: isCalendarDate })
  startDate: string;

  @Prop({
    type: String,
    enum: ItineraryVisibility,
    required: true,
    default: ItineraryVisibility.PRIVATE,
  })
  visibility: ItineraryVisibility;

  @Prop({
    type: [ItineraryDaySchema],
    default: [],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (days: (ItineraryDay | null)[]) =>
        days.length <= 60 && days.every(Boolean),
      message: 'An itinerary may have at most 60 days.',
    },
  })
  days: ItineraryDay[];

  @Prop({ type: ItineraryAttributionSchema })
  clonedFrom?: ItineraryAttribution;

  @Prop({ type: Date })
  hiddenAt?: Date;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });
ItinerarySchema.index({ visibility: 1, hiddenAt: 1, countryCodes: 1 });
ItinerarySchema.index({ visibility: 1, hiddenAt: 1, 'days.cityId': 1 });
