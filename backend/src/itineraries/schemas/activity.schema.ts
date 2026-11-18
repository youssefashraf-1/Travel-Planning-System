import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Image, imageListOptions } from '../../common/schemas/image.schema';
import { LOCAL_TIME_PATTERN } from '../../common/validation/local-time';

@Schema({ _id: false })
class ActivityCost {
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  amountMinorUnits: number;

  @Prop({ required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ })
  currency: string;
}

const ActivityCostSchema = SchemaFactory.createForClass(ActivityCost);

@Schema()
export class Activity {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ type: String, match: LOCAL_TIME_PATTERN })
  localTime?: string;

  @Prop({ type: ActivityCostSchema })
  cost?: ActivityCost;

  @Prop(imageListOptions)
  images: Image[];
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
