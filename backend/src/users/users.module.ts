import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  Currency,
  CurrencySchema,
} from '../reference-data/schemas/currency.schema';
import { AccountDeactivationService } from './account-deactivation.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Currency.name, schema: CurrencySchema },
      // Read-only here: deactivation checks for upcoming bookings (ACC-12).
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    // AuthModule provides JwtAuthGuard; it also imports this module.
    forwardRef(() => AuthModule),
  ],
  controllers: [UsersController],
  providers: [UsersService, AccountDeactivationService],
  exports: [UsersService],
})
export class UsersModule {}
