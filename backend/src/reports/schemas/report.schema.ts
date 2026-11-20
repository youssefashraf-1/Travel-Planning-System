import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BlogPost } from '../../blog/schemas/blog-post.schema';
import { Comment } from '../../blog/schemas/comment.schema';
import { Itinerary } from '../../itineraries/schemas/itinerary.schema';
import { Review } from '../../reviews/schemas/review.schema';
import { User } from '../../users/schemas/user.schema';

export const reportableContentModels = [
  BlogPost.name,
  Comment.name,
  Review.name,
  Itinerary.name,
];

export enum ReportStatus {
  OPEN = 'open',
  DISMISSED = 'dismissed',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_DELETED = 'content_deleted',
}

function requiresResolution(this: Report): boolean {
  return this.status !== ReportStatus.OPEN;
}

@Schema({ timestamps: true })
export class Report {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: reportableContentModels, required: true })
  targetModel: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    refPath: 'targetModel',
    required: true,
  })
  targetId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({
    type: String,
    enum: ReportStatus,
    required: true,
    default: ReportStatus.OPEN,
  })
  status: ReportStatus;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: requiresResolution,
  })
  resolvedById?: Types.ObjectId;

  @Prop({ type: Date, required: requiresResolution })
  resolvedAt?: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);

ReportSchema.index(
  { reporterId: 1, targetModel: 1, targetId: 1 },
  { unique: true },
);
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ targetModel: 1, targetId: 1, status: 1 });

ReportSchema.pre('validate', function () {
  if (
    this.status === ReportStatus.OPEN &&
    (this.resolvedById != null || this.resolvedAt != null)
  ) {
    this.invalidate('status', 'An open report cannot have resolution details.');
  }
});
