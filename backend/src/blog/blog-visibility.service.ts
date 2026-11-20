import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { User, UserStatus } from '../users/schemas/user.schema';
import { BlogPost, BlogPostStatus } from './schemas/blog-post.schema';

/** Shared public visibility and the transaction fence used by community writes. */
@Injectable()
export class BlogVisibilityService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async publicPost(id: string, session: ClientSession | null = null) {
    const post = Types.ObjectId.isValid(id)
      ? await this.posts
          .findOne({
            _id: id,
            status: BlogPostStatus.PUBLISHED,
            hiddenAt: null,
          })
          .session(session)
          .exec()
      : null;
    const author =
      post &&
      (await this.users
        .exists({
          _id: post.authorId,
          status: { $ne: UserStatus.DEACTIVATED },
        })
        .session(session));
    if (!post || !author) throw new NotFoundException('Post not found.');
    return post;
  }

  /** Serializes likes/comments/reports against post edits, hiding and deletion. */
  async lock(id: string, session: ClientSession, publicOnly = true) {
    if (publicOnly) await this.publicPost(id, session);
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Post not found.');
    const post = await this.posts
      .findOneAndUpdate(
        { _id: id },
        { $inc: { __v: 1 } },
        { session, returnDocument: 'after', timestamps: false },
      )
      .exec();
    if (!post) throw new ConflictException('Post changed. Reload and retry.');
    return post;
  }
}
