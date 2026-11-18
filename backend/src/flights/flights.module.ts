import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Flight, FlightSchema } from './schemas/flight.schema';
import {
  CabinInventory,
  CabinInventorySchema,
} from './schemas/cabin-inventory.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
    ]),
  ],
})
export class FlightsModule {}
