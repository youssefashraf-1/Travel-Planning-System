import { AuthModule } from '../auth/auth.module';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from './schemas/airline.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Airline.name, schema: AirlineSchema }]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [AirlinesService],
})
export class AirlinesModule {}
