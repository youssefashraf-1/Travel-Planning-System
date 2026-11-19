import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { City, CitySchema } from '../reference-data/schemas/city.schema';
import {
  Country,
  CountrySchema,
} from '../reference-data/schemas/country.schema';
import { ReviewsModule } from '../reviews/reviews.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { HotelStayStatusService } from './hotel-stay-status.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from './schemas/room-availability.schema';
import { Room, RoomSchema } from './schemas/room.schema';

/**
 * Hotel management (HTL-01 to HTL-10, HTL-15, HTL-22). Phase 8 booking uses
 * RoomsService.lockAvailability(), roomIsFree() and checkStay().
 */
@Module({
  imports: [
    AuthModule,
    ReviewsModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: City.name, schema: CitySchema },
      { name: Country.name, schema: CountrySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [HotelsController],
  providers: [HotelsService, RoomsService, HotelStayStatusService],
  exports: [RoomsService, HotelStayStatusService],
})
export class HotelsModule {}
