import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import { BlogVisibilityService } from './blog-visibility.service';
import {
  BlogCommentDto,
  BlogCommentListDto,
  BlogLikeDto,
} from './dto/blog-community.dto';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';

type StoredComment = Comment & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BlogCommunityService {
  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly visibility: BlogVisibilityService,
  ) {}

  async list(postId: string, page: number): Promise<BlogCommentListDto> {
    await this.visibility.publicPost(postId);
    return this.visibleComments(new Types.ObjectId(postId), page);
  }

  /** Used only after the caller has authorized access to the parent post. */
  async visibleComments(
    postId: Types.ObjectId,
    page = 1,
  ): Promise<BlogCommentListDto> {
    return this.page({ postId, hiddenAt: null }, page, 1);
  }

  async mine(user: UserDocument, page: number): Promise<BlogCommentListDto> {
    return this.page({ authorId: user._id }, page, -1);
  }

  async add(
    user: UserDocument,
    postId: string,
    body: string,
  ): Promise<BlogCommentDto> {
    const id = new Types.ObjectId();
    const stored = await this.comments.db.transaction(async (session) => {
      const post = await this.visibility.lock(postId, session);
      const [comment] = await this.comments.create(
        [{ _id: id, postId: post._id, authorId: user._id, body }],
        { session },
      );
      return comment.toObject<StoredComment>();
    });
    return (await this.present([stored]))[0];
  }

  async edit(
    user: UserDocument,
    id: string,
    body: string,
  ): Promise<BlogCommentDto> {
    const stored = await this.comments.db.transaction(async (session) => {
      const comment = Types.ObjectId.isValid(id)
        ? await this.comments
            .findOne({ _id: id, authorId: user._id })
            .session(session)
            .exec()
        : null;
      if (!comment) throw new NotFoundException('Comment not found.');
      await this.visibility.lock(comment.postId.toString(), session, false);
      // Updating text never clears hiddenAt. Owner can still manage a hidden comment.
      return this.comments
        .findOneAndUpdate(
          { _id: comment._id, authorId: user._id },
          { $set: { body } },
          { session, returnDocument: 'after' },
        )
        .lean<StoredComment>()
        .orFail()
        .exec();
    });
    return (await this.present([stored]))[0];
  }

  async remove(user: UserDocument, id: string): Promise<void> {
    await this.comments.db.transaction(async (session) => {
      const comment = Types.ObjectId.isValid(id)
        ? await this.comments
            .findOne({ _id: id, authorId: user._id })
            .session(session)
            .exec()
        : null;
      if (!comment) throw new NotFoundException('Comment not found.');
      await this.visibility.lock(comment.postId.toString(), session, false);
      await this.comments.deleteOne({ _id: comment._id }, { session }).exec();
    });
  }

  async like(
    user: UserDocument,
    postId: string,
    liked: boolean,
  ): Promise<BlogLikeDto> {
    await this.likes.db.transaction(async (session) => {
      const post = await this.visibility.lock(postId, session);
      const filter = { postId: post._id, userId: user._id };
      if (liked)
        await this.likes
          .updateOne(
            filter,
            { $setOnInsert: filter },
            { session, upsert: true },
          )
          .exec();
      else await this.likes.deleteOne(filter, { session }).exec();
    });
    return {
      liked,
      likeCount: await this.likes
        .countDocuments({ postId: new Types.ObjectId(postId) })
        .exec(),
    };
  }

  private async page(
    filter: object,
    page: number,
    direction: 1 | -1,
  ): Promise<BlogCommentListDto> {
    const [items, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ createdAt: direction, _id: direction })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<StoredComment[]>()
        .exec(),
      this.comments.countDocuments(filter).exec(),
    ]);
    return { ...pageInfo(page, total), items: await this.present(items) };
  }

  private async present(items: StoredComment[]): Promise<BlogCommentDto[]> {
    const authors = await this.users
      .find({ _id: { $in: items.map((item) => item.authorId) } })
      .select('_id name status')
      .lean()
      .exec();
    const byId = new Map(
      authors.map((author) => [author._id.toString(), author]),
    );
    return items.map((item) => {
      const author = byId.get(item.authorId.toString());
      const deleted = !author || author.status === UserStatus.DEACTIVATED;
      return {
        id: item._id.toString(),
        postId: item.postId.toString(),
        body: item.body,
        authorName: deleted ? 'Deleted user' : author.name,
        authorId: deleted ? undefined : author._id.toString(),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        hidden: item.hiddenAt != null,
      };
    });
  }
}
