import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  assertManagesProvider,
  assertOwnedBy,
  ProviderType,
} from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { hotelNow } from '../hotels/hotel-dates';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import {
  CreateReviewDto,
  HotelReviewListDto,
  MyReviewDto,
  ReplyToReviewDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { Review } from './schemas/review.schema';

export const DELETED_USER = 'Deleted user';

/** Hidden reviews (GEN-10) never count or show publicly. */
const VISIBLE = { hiddenAt: null };

type StoredReview = Review & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/** HTL-23, HTL-24: one review per completed stay, and the public summary. */
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /**
   * Only the reservation's owner can review it, once, after it is
   * Completed. The hotel and author come from the reservation and session.
   */
  async create(
    user: UserDocument,
    bookingId: string,
    dto: CreateReviewDto,
    now = new Date(),
  ): Promise<MyReviewDto> {
    const booking = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId).lean().exec()
      : null;
    if (!booking) throw new NotFoundException('Reservation not found.');
    assertOwnedBy(user, booking.userId, 'Reservation not found.');
    // HTL-23: a confirmed stay is completed once check-out has passed, even
    // if the 30-second status sweep has not reached it yet.
    if (
      booking.status === BookingStatus.CONFIRMED &&
      `${booking.checkOutDate}T${booking.policy.checkOutTime}` <=
        hotelNow(booking.timeZone, now).dateTime
    ) {
      await this.bookings
        .updateOne(
          { _id: booking._id, status: BookingStatus.CONFIRMED },
          { $set: { status: BookingStatus.COMPLETED } },
        )
        .exec();
      booking.status = BookingStatus.COMPLETED;
    }
    if (booking.status !== BookingStatus.COMPLETED)
      throw new ConflictException(
        'You can review a stay once it is completed (after check-out).',
      );
    if (await this.reviews.exists({ bookingId: booking._id }))
      throw new ConflictException(
        'You already reviewed this stay; edit your review instead.',
      );

    try {
      const review = await this.reviews.create({
        bookingId: booking._id,
        hotelId: booking.hotelId,
        authorId: user._id,
        rating: dto.rating,
        body: dto.body || undefined,
      });
      return this.presentMine(
        review.toObject() as unknown as StoredReview,
        user.name,
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException(
          'You already reviewed this stay; edit your review instead.',
        );
      throw error;
    }
  }

  async update(
    user: UserDocument,
    id: string,
    dto: UpdateReviewDto,
  ): Promise<MyReviewDto> {
    if (dto.rating === undefined && dto.body === undefined)
      throw new BadRequestException('Send a new rating or review text.');
    const review = await this.findOwn(user, id);
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.body !== undefined) review.body = dto.body || undefined;
    await review.save();
    return this.presentMine(
      review.toObject() as unknown as StoredReview,
      user.name,
    );
  }

  async remove(user: UserDocument, id: string): Promise<void> {
    const review = await this.findOwn(user, id);
    await review.deleteOne();
  }

  /**
   * HTL-26 (optional): the moderator of the review's hotel replies, or
   * replaces the earlier reply. Hidden reviews cannot be answered.
   */
  async reply(
    user: UserDocument,
    id: string,
    dto: ReplyToReviewDto,
    now = new Date(),
  ): Promise<ReviewDto> {
    const review = Types.ObjectId.isValid(id)
      ? await this.reviews.findOne({ _id: id, ...VISIBLE }).exec()
      : null;
    if (!review) throw new NotFoundException('Review not found.');
    assertManagesProvider(user, ProviderType.HOTEL, review.hotelId);
    review.reply = { body: dto.body, moderatorId: user._id, repliedAt: now };
    await review.save();
    const author = await this.users
      .findById(review.authorId)
      .select('name status')
      .lean()
      .exec();
    return this.present(
      review.toObject() as unknown as StoredReview,
      !author || author.status === UserStatus.DEACTIVATED
        ? DELETED_USER
        : author.name,
    );
  }

  /** HTL-24: newest first, 10 per page, with the hotel's rating summary. */
  async listForHotel(hotelId: string, page = 1): Promise<HotelReviewListDto> {
    const hotel = Types.ObjectId.isValid(hotelId)
      ? await this.hotels.exists({ _id: hotelId })
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found.');
    const [summary, items] = await Promise.all([
      this.ratingSummary(hotel._id),
      this.latest(hotel._id, page, PAGE_SIZE),
    ]);
    return {
      ...summary,
      ...pageInfo(page, summary.ratingCount),
      items,
    };
  }

  /** Average (one decimal) and count of visible ratings. */
  async ratingSummary(
    hotelId: Types.ObjectId,
  ): Promise<{ averageRating?: number; ratingCount: number }> {
    const [row] = await this.reviews
      .aggregate<{ average: number; count: number }>([
        { $match: { hotelId, ...VISIBLE } },
        {
          $group: {
            _id: null,
            average: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    return row
      ? {
          averageRating: Math.round(row.average * 10) / 10,
          ratingCount: row.count,
        }
      : { ratingCount: 0 };
  }

  async latest(
    hotelId: Types.ObjectId,
    page: number,
    size: number,
  ): Promise<ReviewDto[]> {
    const reviews = await this.reviews
      .find({ hotelId, ...VISIBLE })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean()
      .exec();
    const authors = await this.users
      .find({ _id: { $in: reviews.map((review) => review.authorId) } })
      .select('name status')
      .lean()
      .exec();
    const nameById = new Map(
      authors.map((author) => [
        author._id.toString(),
        author.status === UserStatus.DEACTIVATED ? DELETED_USER : author.name,
      ]),
    );
    return reviews.map((review) =>
      this.present(
        review as unknown as StoredReview,
        nameById.get(review.authorId.toString()) ?? DELETED_USER,
      ),
    );
  }

  private async findOwn(user: UserDocument, id: string) {
    const review = Types.ObjectId.isValid(id)
      ? await this.reviews.findById(id).exec()
      : null;
    if (!review) throw new NotFoundException('Review not found.');
    assertOwnedBy(user, review.authorId, 'Review not found.');
    return review;
  }

  private present(
    review: StoredReview,
    authorName: string,
  ): Pick<ReviewDto, keyof ReviewDto> {
    return {
      id: review._id.toString(),
      rating: review.rating,
      body: review.body,
      authorName,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      reply: review.reply
        ? { body: review.reply.body, repliedAt: review.reply.repliedAt }
        : undefined,
    };
  }

  private presentMine(review: StoredReview, authorName: string): MyReviewDto {
    return {
      ...this.present(review, authorName),
      hotelId: review.hotelId.toString(),
      bookingId: review.bookingId.toString(),
    };
  }
}
