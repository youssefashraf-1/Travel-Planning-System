import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Error as MongooseError,
  HydratedDocument,
  Model,
  Types,
} from 'mongoose';
import { PAGE_SIZE, pageInfo, PageQueryDto } from '../common/pagination';
import {
  ImageUploadsService,
  UploadedImage,
} from '../common/uploads/image-uploads.service';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import {
  CreateBlogPostDto,
  PublishedPostsQueryDto,
  UpdateBlogPostDto,
} from './dto/blog-post-requests.dto';
import {
  BlogPostDetailsDto,
  BlogPostListDto,
  BlogPostSummaryDto,
} from './dto/blog-post-responses.dto';
import { BlogPost, BlogPostStatus } from './schemas/blog-post.schema';
import { Comment } from './schemas/comment.schema';
import { Like } from './schemas/like.schema';

type PostDocument = HydratedDocument<BlogPost>;
type StoredPost = Omit<BlogPost, 'images'> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  images: { _id: Types.ObjectId; url: string }[];
};
type Author = { _id: Types.ObjectId; name: string };
const NOT_FOUND = 'Post not found.';

/** Core posts. Every write selects the owner; public reads exclude hidden drafts/authors. */
@Injectable()
export class BlogPostsService {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly uploads: ImageUploadsService,
  ) {}

  async create(
    user: UserDocument,
    dto: CreateBlogPostDto,
  ): Promise<BlogPostDetailsDto> {
    const status = dto.status ?? BlogPostStatus.DRAFT;
    const post = await this.posts.create({
      authorId: user._id,
      title: dto.title,
      body: dto.body,
      status,
      tags: dto.tags ?? [],
      publishedAt: status === BlogPostStatus.PUBLISHED ? new Date() : undefined,
    });
    return this.details(post, user);
  }

  /** BLG-02: fixed pages of ten, newest published first, exact normalized tag. */
  async listPublished(query: PublishedPostsQueryDto): Promise<BlogPostListDto> {
    const page = query.page ?? 1;
    const result = await this.posts
      .aggregate<{
        items: (StoredPost & { author: Author })[];
        total: { count: number }[];
      }>([
        {
          $match: {
            status: BlogPostStatus.PUBLISHED,
            hiddenAt: null,
            ...(query.tag === undefined ? {} : { tags: query.tag }),
          },
        },
        {
          $lookup: {
            from: this.users.collection.name,
            localField: 'authorId',
            foreignField: '_id',
            pipeline: [
              { $match: { status: { $ne: UserStatus.DEACTIVATED } } },
              { $project: { _id: 1, name: 1 } },
            ],
            as: 'author',
          },
        },
        { $unwind: '$author' },
        {
          $facet: {
            items: [
              { $sort: { publishedAt: -1, _id: -1 } },
              { $skip: (page - 1) * PAGE_SIZE },
              { $limit: PAGE_SIZE },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();
    const data = result[0];
    return {
      ...pageInfo(page, data?.total[0]?.count ?? 0),
      items: await Promise.all(
        (data?.items ?? []).map((p) => this.summary(p, p.author)),
      ),
    };
  }

  async publishedDetails(id: string): Promise<BlogPostDetailsDto> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(NOT_FOUND);
    const post = await this.posts
      .findOne({
        _id: id,
        status: BlogPostStatus.PUBLISHED,
        hiddenAt: null,
      })
      .exec();
    const author = post
      ? await this.users
          .findOne({
            _id: post.authorId,
            status: { $ne: UserStatus.DEACTIVATED },
          })
          .select('_id name')
          .exec()
      : null;
    if (!post || !author) throw new NotFoundException(NOT_FOUND);
    return this.details(post, author);
  }

  async listMine(
    user: UserDocument,
    query: PageQueryDto,
  ): Promise<BlogPostListDto> {
    const page = query.page ?? 1;
    const filter = { authorId: user._id };
    const [items, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<StoredPost[]>()
        .exec(),
      this.posts.countDocuments(filter).exec(),
    ]);
    return {
      ...pageInfo(page, total),
      items: await Promise.all(items.map((p) => this.summary(p, user))),
    };
  }

  async ownDetails(
    user: UserDocument,
    id: string,
  ): Promise<BlogPostDetailsDto> {
    return this.details(await this.own(user, id), user);
  }

  async update(
    user: UserDocument,
    id: string,
    dto: UpdateBlogPostDto,
  ): Promise<BlogPostDetailsDto> {
    const post = await this.own(user, id);
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined && dto.status !== post.status) {
      post.status = dto.status;
      post.publishedAt =
        dto.status === BlogPostStatus.PUBLISHED ? new Date() : undefined;
    }
    await this.save(post);
    return this.details(post, user);
  }

  /** Remove dependent records atomically, then clean up this post's files. */
  async remove(user: UserDocument, id: string): Promise<void> {
    const post = await this.own(user, id);
    await this.posts.db.transaction(async (session) => {
      const deleted = await this.posts
        .deleteOne(
          {
            _id: post._id,
            authorId: user._id,
            __v: post.__v,
          },
          { session },
        )
        .exec();
      if (deleted.deletedCount !== 1)
        throw new ConflictException('Post changed. Reload and retry.');
      await this.comments.deleteMany({ postId: post._id }, { session }).exec();
      await this.likes.deleteMany({ postId: post._id }, { session }).exec();
    });
    await Promise.all(
      post.images.map((image) => this.uploads.remove(image.url)),
    );
  }

  /** BLG-10/GEN-08: only uploaded JPG/PNG files, no client-controlled paths. */
  async addImage(
    user: UserDocument,
    id: string,
    file: UploadedImage | undefined,
  ): Promise<BlogPostDetailsDto> {
    const post = await this.own(user, id);
    if (post.images.length >= 5)
      throw new BadRequestException('A post can have at most five images.');
    const url = await this.uploads.save(file, 'posts');
    post.images.push({ url });
    try {
      await this.save(post);
    } catch (error) {
      await this.uploads.remove(url);
      throw error;
    }
    return this.details(post, user);
  }

  async removeImage(
    user: UserDocument,
    id: string,
    imageId: string,
  ): Promise<BlogPostDetailsDto> {
    const post = await this.own(user, id);
    const images = post.images as Types.DocumentArray<{ url: string }>;
    const image = Types.ObjectId.isValid(imageId) ? images.id(imageId) : null;
    if (!image) throw new NotFoundException('Image not found.');
    const url = image.url;
    image.deleteOne();
    await this.save(post);
    await this.uploads.remove(url);
    return this.details(post, user);
  }

  private async own(user: UserDocument, id: string): Promise<PostDocument> {
    const post = Types.ObjectId.isValid(id)
      ? await this.posts.findOne({ _id: id, authorId: user._id }).exec()
      : null;
    if (!post) throw new NotFoundException(NOT_FOUND);
    return post;
  }

  private async save(post: PostDocument): Promise<void> {
    try {
      await post.save();
    } catch (error) {
      if (
        error instanceof MongooseError.VersionError ||
        error instanceof MongooseError.DocumentNotFoundError
      )
        throw new ConflictException('Post changed. Reload and retry.');
      throw error;
    }
  }

  private async details(
    post: PostDocument,
    author: Author,
  ): Promise<BlogPostDetailsDto> {
    const stored = post.toObject<StoredPost>();
    return Object.assign(await this.summary(stored, author), {
      body: stored.body,
    });
  }

  private async summary(
    post: StoredPost,
    author: Author,
  ): Promise<BlogPostSummaryDto> {
    const [likeCount, commentCount] = await Promise.all([
      this.likes.countDocuments({ postId: post._id }).exec(),
      this.comments.countDocuments({ postId: post._id, hiddenAt: null }).exec(),
    ]);
    return {
      id: post._id.toString(),
      title: post.title,
      status: post.status,
      author: { id: author._id.toString(), name: author.name },
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      publishedAt: post.publishedAt,
      tags: post.tags,
      images: post.images.map((image) => ({
        id: image._id.toString(),
        url: image.url,
      })),
      likeCount,
      commentCount,
      hidden: post.hiddenAt != null,
    };
  }
}
