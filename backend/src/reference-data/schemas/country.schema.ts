import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Currency } from './currency.schema';

@Schema()
export class Country {
  @Prop({ type: String, required: true, match: /^[A-Z]{2}$/ })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, match: /^[A-Z]{3}$/, ref: Currency.name })
  currencyCode: string;
}

export const CountrySchema = SchemaFactory.createForClass(Country);
