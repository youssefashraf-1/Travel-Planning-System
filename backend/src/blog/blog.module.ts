import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ImageUploadsService } from '../common/uploads/image-uploads.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { BlogPostsController } from './blog-posts.controller';
import { BlogPostsService } from './blog-posts.service';
import { BlogPost, BlogPostSchema } from './schemas/blog-post.schema';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import {
  Itinerary,
  ItinerarySchema,
} from '../itineraries/schemas/itinerary.schema';
import { BlogVisibilityService } from './blog-visibility.service';
import { BlogCommunityService } from './blog-community.service';
import { BlogCommunityController } from './blog-community.controller';
import { BlogAuthorsService } from './blog-authors.service';
import { BlogAuthorsController } from './blog-authors.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: BlogPost.name, schema: BlogPostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [
    BlogPostsController,
    BlogCommunityController,
    BlogAuthorsController,
  ],
  providers: [
    BlogPostsService,
    ImageUploadsService,
    BlogVisibilityService,
    BlogCommunityService,
    BlogAuthorsService,
  ],
})
export class BlogModule {}
