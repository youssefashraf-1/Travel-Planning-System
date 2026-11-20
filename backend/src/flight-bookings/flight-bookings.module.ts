import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
import { AuthModule } from '../auth/auth.module';
import {
  CabinInventory,
  CabinInventorySchema,
} from '../flights/schemas/cabin-inventory.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';
import { StripeGateway } from '../payments/stripe-gateway';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightChangesService } from './flight-changes.service';
import { FlightSeatMapController } from './flight-seat-map.controller';
import { FlightSeatsService } from './flight-seats.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import {
  FlightChange,
  FlightChangeSchema,
} from './schemas/flight-change.schema';
import {
  SeatAssignment,
  SeatAssignmentSchema,
} from './schemas/seat-assignment.schema';

/**
 * Flight booking (FLT-19 to FLT-28). The payment service confirms paid
 * holds through FlightBookingLifecycleService.confirmPaidBooking().
 */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: FlightChange.name, schema: FlightChangeSchema },
      { name: SeatAssignment.name, schema: SeatAssignmentSchema },
    ]),
  ],
  controllers: [FlightBookingsController, FlightSeatMapController],
  providers: [
    FlightBookingsService,
    FlightBookingLifecycleService,
    FlightChangesService,
    FlightSeatsService,
    StripeGateway,
  ],
  exports: [FlightBookingLifecycleService, FlightChangesService],
})
export class FlightBookingsModule {}
