import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { City } from './city.schema';

@Schema()
export class Attraction {
  @Prop({ type: String, required: true, trim: true })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, ref: City.name })
  cityId: string;
}

export const AttractionSchema = SchemaFactory.createForClass(Attraction);
AttractionSchema.index({ cityId: 1, name: 1 });
