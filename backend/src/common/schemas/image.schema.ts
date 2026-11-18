import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema()
export class Image {
  @Prop({ required: true, trim: true })
  url: string;
}

export const ImageSchema = SchemaFactory.createForClass(Image);

export const imageListOptions = {
  type: [ImageSchema],
  default: [],
  required: true,
  castNonArrays: false,
  validate: {
    validator: (images: (Image | null)[]) =>
      images.length <= 5 && images.every(Boolean),
    message: 'Provide at most five images.',
  },
};
