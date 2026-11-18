import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema()
export class TransportCost {
  @Prop({ required: true, trim: true })
  mode: string;

  @Prop({ required: true, trim: true })
  fromCityId: string;

  @Prop({
    required: true,
    trim: true,
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

  @Prop({ required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ })
  currency: string;
}

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);
