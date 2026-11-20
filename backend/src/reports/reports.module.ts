import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Report, ReportSchema } from './schemas/report.schema';
import { AuthModule } from '../auth/auth.module';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { BlogPost, BlogPostSchema } from '../blog/schemas/blog-post.schema';
import { Comment, CommentSchema } from '../blog/schemas/comment.schema';
import { Like, LikeSchema } from '../blog/schemas/like.schema';
import { BlogVisibilityService } from '../blog/blog-visibility.service';
import { ImageUploadsService } from '../common/uploads/image-uploads.service';
import {
  Itinerary,
  ItinerarySchema,
} from '../itineraries/schemas/itinerary.schema';
import { Review, ReviewSchema } from '../reviews/schemas/review.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ReportsService } from './reports.service';
import {
  ContentModerationController,
  ReportsController,
} from './reports.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: BlogPost.name, schema: BlogPostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Review.name, schema: ReviewSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ReportsController, ContentModerationController],
  providers: [ReportsService, BlogVisibilityService, ImageUploadsService],
})
export class ReportsModule {}
