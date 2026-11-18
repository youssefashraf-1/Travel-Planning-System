import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { City } from '../../reference-data/schemas/city.schema';
import { Currency } from '../../reference-data/schemas/currency.schema';

@Schema()
export class TransportCost {
  @Prop({ required: true, trim: true })
  mode: string;

  @Prop({ required: true, trim: true, ref: City.name })
  fromCityId: string;

  @Prop({
    required: true,
    trim: true,
    ref: City.name,
    validate: {
      validator: function (this: TransportCost, value: string) {
        return value !== this.fromCityId;
      },
      message: 'Intercity transport must connect two different cities.',
    },
  })
  toCityId: string;

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

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);
