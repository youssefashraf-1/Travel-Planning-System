import { AuthModule } from '../auth/auth.module';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
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
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
    ]),
  ],
  controllers: [FlightsController],
  providers: [FlightsService, FlightStatusService],
  exports: [FlightsService, FlightStatusService],
})
export class FlightsModule {}
