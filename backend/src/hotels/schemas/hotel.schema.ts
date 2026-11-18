import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Image, imageListOptions } from '../../common/schemas/image.schema';
import { isIanaTimeZone } from '../../common/validation/local-time';
import { City } from '../../reference-data/schemas/city.schema';
import { Country } from '../../reference-data/schemas/country.schema';
import { HotelPolicy, HotelPolicySchema } from './hotel-policy.schema';

@Schema({ timestamps: true })
export class Hotel {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  address: string;

  @Prop({ required: true, trim: true, ref: City.name })
  cityId: string;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{2}$/,
    ref: Country.name,
  })
  countryCode: string;

  @Prop({ required: true, trim: true, validate: isIanaTimeZone })
  timeZone: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ required: true, min: 1, max: 5, validate: Number.isInteger })
  starClass: number;

  @Prop({
    type: [{ type: String, required: true, trim: true }],
    default: [],
    required: true,
    castNonArrays: false,
  })
  amenities: string[];

  @Prop(imageListOptions)
  photos: Image[];

  @Prop({ type: HotelPolicySchema })
  policy?: HotelPolicy;

  @Prop({ required: true, default: true })
  isActive: boolean;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);

HotelSchema.index({ countryCode: 1, isActive: 1 });
HotelSchema.index({ cityId: 1, isActive: 1 });
