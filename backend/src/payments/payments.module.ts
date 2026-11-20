import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import {
  FlightChange,
  FlightChangeSchema,
} from '../flight-bookings/schemas/flight-change.schema';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { BookingTargets } from './booking-targets';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeGateway } from './stripe-gateway';

/** Stripe payments, policies and refunds (PAY-01 to PAY-04). */
@Module({
  imports: [
    AuthModule,
    FlightBookingsModule,
    HotelBookingsModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: FlightChange.name, schema: FlightChangeSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [StripeGateway, BookingTargets, PaymentsService, RefundsService],
  exports: [RefundsService],
})
export class PaymentsModule {}
