
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AirlinesModule } from '../airlines/airlines.module';
import { AirportsModule } from '../airports/airports.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightsModule } from '../flights/flights.module';
import { UsersModule } from '../users/users.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // 1. Load environment variables from .env
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // 2. Connect NestJS to MongoDB Atlas
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
    }),

    // 3. Optional NestJS monitoring
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),

    UsersModule,
    AirlinesModule,
    AirportsModule,
    FlightsModule,
    FlightBookingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
