import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema()
export class Currency {
  @Prop({ type: String, required: true, match: /^[A-Z]{3}$/ })
  _id: string;
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);
