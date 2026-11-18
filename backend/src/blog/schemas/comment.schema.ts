import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { BlogPost } from './blog-post.schema';

@Schema({ timestamps: true })
export class Comment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: BlogPost.name,
    required: true,
  })
  postId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 500 })
  body: string;

  @Prop({ type: Date })
  hiddenAt?: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);

CommentSchema.index({ postId: 1, hiddenAt: 1, createdAt: 1 });
