import {
  FlightChange,
  FlightChangeSchema,
} from '../flight-bookings/schemas/flight-change.schema';
import { FlightBookingViewsService } from './flight-booking-views.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';
import { FlightManagementService } from './flight-management.service';
import { AuthModule } from '../auth/auth.module';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
import { FlightSearchService } from './flight-search.service';
import { FlightsReadController } from './flights-read.controller';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { FlightStatusService } from './flight-status.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Flight, FlightSchema } from './schemas/flight.schema';
import {
  CabinInventory,
  CabinInventorySchema,
} from './schemas/cabin-inventory.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: FlightChange.name, schema: FlightChangeSchema },
    ]),
  ],
  controllers: [FlightsReadController, FlightsController],
  providers: [
    FlightsService,
    FlightStatusService,
    FlightSearchService,
    FlightManagementService,
    FlightBookingViewsService,
  ],
  exports: [FlightsService, FlightStatusService, FlightSearchService],
})
export class FlightsModule {}
