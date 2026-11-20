import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import {
  Itinerary,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema';
import { User, UserStatus } from '../users/schemas/user.schema';
import { BlogPostsService } from './blog-posts.service';
import { AuthorPageQueryDto } from './dto/blog-community.dto';
import { BlogAuthorPageDto } from './dto/blog-author.dto';

@Injectable()
export class BlogAuthorsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    private readonly posts: BlogPostsService,
  ) {}

  async page(
    id: string,
    query: AuthorPageQueryDto,
  ): Promise<BlogAuthorPageDto> {
    const author = Types.ObjectId.isValid(id)
      ? await this.users
          .findOne({
            _id: id,
            status: { $ne: UserStatus.DEACTIVATED },
          })
          .select('_id name createdAt')
          .lean<User & { _id: Types.ObjectId; createdAt: Date }>()
          .exec()
      : null;
    if (!author) throw new NotFoundException('Author not found.');
    const page = query.itinerariesPage;
    const filter = {
      ownerId: author._id,
      visibility: ItineraryVisibility.PUBLIC,
      hiddenAt: null,
    };
    const [posts, itineraries, total] = await Promise.all([
      this.posts.listPublished({ page: query.page }, author._id),
      this.itineraries
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    return {
      id: author._id.toString(),
      name: author.name,
      joinedAt: author.createdAt,
      posts,
      itineraries: {
        ...pageInfo(page, total),
        items: itineraries.map((item) => ({
          id: item._id.toString(),
          title: item.title,
          countryCodes: item.countryCodes,
          startDate: item.startDate,
          numberOfDays: item.days.length,
        })),
      },
    };
  }
}
