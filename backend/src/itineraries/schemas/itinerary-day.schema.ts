import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { City } from '../../reference-data/schemas/city.schema';
import { Activity, ActivitySchema } from './activity.schema';
import { BudgetEntry, BudgetEntrySchema } from './budget-entry.schema';
import { TransportCost, TransportCostSchema } from './transport-cost.schema';

const dayListOptions = {
  default: [],
  required: true,
  castNonArrays: false,
  validate: {
    validator: (entries: unknown[]) => entries.every(Boolean),
    message: 'Day entries must be present.',
  },
};

/** ITN-27 (optional): a confirmed flight or hotel booking linked to a day. */
@Schema()
export class LinkedBooking {
  @Prop({
    type: String,
    enum: ['FlightBooking', 'HotelBooking'],
    required: true,
  })
  bookingModel: 'FlightBooking' | 'HotelBooking';

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId: Types.ObjectId;
}

const LinkedBookingSchema = SchemaFactory.createForClass(LinkedBooking);

@Schema()
export class ItineraryDay {
  @Prop({ required: true, trim: true, ref: City.name })
  cityId: string;

  @Prop({ type: String, trim: true })
  notes?: string;

  @Prop({ type: [ActivitySchema], ...dayListOptions })
  activities: Activity[];

  @Prop({ type: [BudgetEntrySchema], ...dayListOptions })
  budgetEntries: BudgetEntry[];

  @Prop({ type: [TransportCostSchema], ...dayListOptions })
  transportCosts: TransportCost[];

  @Prop({ type: [LinkedBookingSchema], ...dayListOptions })
  linkedBookings: LinkedBooking[];
}

export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);
