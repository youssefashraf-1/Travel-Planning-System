import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airport, AirportSchema } from './schemas/airport.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Airport.name, schema: AirportSchema }]),
  ],
})
export class AirportsModule {}
