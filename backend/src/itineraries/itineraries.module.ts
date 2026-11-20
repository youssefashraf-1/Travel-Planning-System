import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { AuthModule } from '../auth/auth.module';
import { ImageUploadsService } from '../common/uploads/image-uploads.service';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { City, CitySchema } from '../reference-data/schemas/city.schema';
import {
  Country,
  CountrySchema,
} from '../reference-data/schemas/country.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  ItinerariesController,
  ItineraryItemsController,
  PublicItinerariesController,
} from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { ItineraryPresenter } from './itinerary-presenter';
import { ItineraryPublicService } from './itinerary-public.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/** Itineraries and budgeting (ITN-01 to ITN-26). */
@Module({
  imports: [
    AuthModule,
    ExchangeRatesModule,
    HotelsModule,
    FlightsModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: City.name, schema: CitySchema },
      { name: Country.name, schema: CountrySchema },
      { name: User.name, schema: UserSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: Hotel.name, schema: HotelSchema },
    ]),
  ],
  // Public routes first, so /itineraries/public/... is not read as an id.
  controllers: [
    PublicItinerariesController,
    ItinerariesController,
    ItineraryItemsController,
  ],
  providers: [
    ItinerariesService,
    ItineraryBudgetService,
    ItineraryPresenter,
    ItineraryPublicService,
    ImageUploadsService,
  ],
})
export class ItinerariesModule {}
