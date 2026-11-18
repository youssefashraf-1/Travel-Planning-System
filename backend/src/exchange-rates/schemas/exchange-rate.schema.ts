import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { isCalendarDate } from '../../common/validation/calendar-date';
import { Currency } from '../../reference-data/schemas/currency.schema';

@Schema({ _id: false })
class CurrencyRate {
  @Prop({ required: true, match: /^[A-Z]{3}$/, ref: Currency.name })
  currencyCode: string;

  @Prop({ required: true, min: Number.MIN_VALUE, validate: Number.isFinite })
  rate: number;
}

const CurrencyRateSchema = SchemaFactory.createForClass(CurrencyRate);

@Schema()
export class ExchangeRate {
  @Prop({ required: true, match: /^[A-Z]{3}$/, ref: Currency.name })
  baseCurrency: string;

  @Prop({ required: true, validate: isCalendarDate })
  rateDate: string;

  @Prop({ required: true, default: Date.now })
  fetchedAt: Date;

  @Prop({
    type: [CurrencyRateSchema],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (rates: (CurrencyRate | null)[]) =>
        rates.length > 0 &&
        rates.every((entry) => entry?.currencyCode) &&
        new Set(rates.map((entry) => entry?.currencyCode)).size ===
          rates.length,
      message: 'Provide a rate for each distinct currency.',
    },
  })
  rates: CurrencyRate[];
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ baseCurrency: 1, rateDate: -1 }, { unique: true });
