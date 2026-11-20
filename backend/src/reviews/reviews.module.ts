import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { Review, ReviewSchema } from './schemas/review.schema';

/** Hotel reviews (HTL-23, HTL-24). HotelsModule uses the rating summary. */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
