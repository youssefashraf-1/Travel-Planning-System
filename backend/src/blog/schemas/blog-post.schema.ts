import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Image, imageListOptions } from '../../common/schemas/image.schema';
import { User } from '../../users/schemas/user.schema';

export enum BlogPostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

@Schema({ timestamps: true })
export class BlogPost {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({
    type: String,
    enum: BlogPostStatus,
    required: true,
    default: BlogPostStatus.DRAFT,
  })
  status: BlogPostStatus;

  @Prop({
    type: Date,
    required: function (this: BlogPost) {
      return this.status === BlogPostStatus.PUBLISHED;
    },
  })
  publishedAt?: Date;

  @Prop({
    type: [
      {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 30,
      },
    ],
    default: [],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (tags: string[]) =>
        tags.length <= 5 && new Set(tags).size === tags.length,
      message: 'Provide at most five distinct tags.',
    },
  })
  tags: string[];

  @Prop(imageListOptions)
  images: Image[];

  @Prop({ type: Date })
  hiddenAt?: Date;
}

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);

BlogPostSchema.index({ authorId: 1, createdAt: -1 });
BlogPostSchema.index({ status: 1, hiddenAt: 1, publishedAt: -1 });
BlogPostSchema.index({ tags: 1, status: 1, hiddenAt: 1, publishedAt: -1 });
