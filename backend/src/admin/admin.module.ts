import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { AuthModule } from '../auth/auth.module';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminProvidersService } from './admin-providers.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminOperationsController } from './admin-operations.controller';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';

/** Administrator features. Account management lives here (ACC-07a, ACC-15, ACC-16). */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
  ],
  controllers: [AdminAccountsController, AdminOperationsController],
  providers: [
    AdminAccountsService,
    AdminProvidersService,
    AdminBookingsService,
    AdminAuditService,
  ],
})
export class AdminModule {}
