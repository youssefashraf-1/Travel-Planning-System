import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Flight, FlightSchema } from './schemas/flight.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Flight.name, schema: FlightSchema }]),
  ],
})
export class FlightsModule {}
