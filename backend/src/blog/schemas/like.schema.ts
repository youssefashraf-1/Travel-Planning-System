import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { BlogPost } from './blog-post.schema';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Like {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: BlogPost.name,
    required: true,
  })
  postId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;
}

export const LikeSchema = SchemaFactory.createForClass(Like);

LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
