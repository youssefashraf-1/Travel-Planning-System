import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { HotelsModule } from '../hotels/hotels.module';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from '../hotels/schemas/room-availability.schema';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';
import { City, CitySchema } from '../reference-data/schemas/city.schema';
import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  HotelBooking,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';

/**
 * Hotel reservations (HTL-16 to HTL-21). The payment service confirms paid
 * holds through HotelBookingLifecycleService.confirmPaidReservation().
 */
@Module({
  imports: [
    AuthModule,
    HotelsModule,
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: City.name, schema: CitySchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [HotelBookingsService, HotelBookingLifecycleService],
  exports: [HotelBookingLifecycleService],
})
export class HotelBookingsModule {}
