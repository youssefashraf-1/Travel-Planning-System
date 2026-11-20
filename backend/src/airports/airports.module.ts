import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airport, AirportSchema } from './schemas/airport.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Airport.name, schema: AirportSchema }]),
  ],
  controllers: [AirportsController],
  providers: [AirportsService],
})
export class AirportsModule {}
