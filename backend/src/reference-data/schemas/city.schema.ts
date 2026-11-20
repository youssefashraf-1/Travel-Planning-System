import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Country } from './country.schema';

@Schema()
export class City {
  @Prop({ type: String, required: true, trim: true })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, match: /^[A-Z]{2}$/, ref: Country.name })
  countryCode: string;
}

export const CitySchema = SchemaFactory.createForClass(City);
CitySchema.index({ countryCode: 1, name: 1 });
