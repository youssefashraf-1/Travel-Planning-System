import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
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
}

export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);
