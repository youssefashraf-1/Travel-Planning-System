import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Currency } from '../../reference-data/schemas/currency.schema';

export enum BudgetCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  IN_CITY_TRANSPORT = 'in_city_transport',
  ACTIVITIES = 'activities',
}

@Schema()
export class BudgetEntry {
  @Prop({ type: String, enum: BudgetCategory, required: true })
  category: BudgetCategory;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  amountMinorUnits: number;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    ref: Currency.name,
  })
  currency: string;
}

export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);
