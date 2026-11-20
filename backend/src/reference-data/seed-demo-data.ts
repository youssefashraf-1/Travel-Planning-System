import 'reflect-metadata';
import { createConnection, type Connection, Types } from 'mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
import {
  CabinClass,
  CabinInventory,
  CabinInventorySchema,
} from '../flights/schemas/cabin-inventory.schema';
import { airportLocalToUtc } from '../flights/local-date-time';
import {
  Flight,
  FlightSchema,
  FlightStatus,
} from '../flights/schemas/flight.schema';
import { addDays, hotelNow } from '../hotels/hotel-dates';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from '../hotels/schemas/room-availability.schema';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';

/**
 * Sample airlines, flights and hotels for demonstrating the API in Swagger.
 * Run after seed:reference. Safe to run again: records are matched by
 * airline code, flight number and date, hotel name and room label. Flights
 * are scheduled 2 to 6 weeks after the run, so re-run it before a demo.
 * Creates no user accounts: an admin creates moderators in Swagger.
 */

const AIRLINES = [
  {
    code: 'NA',
    name: 'Nile Air',
    extraBaggagePolicy: {
      pricePerBagMinorUnits: 75_000,
      maxExtraBagsPerPassenger: 2,
    },
    cancellationTiers: [
      { daysBeforeDeparture: 14, refundPercentage: 100 },
      { daysBeforeDeparture: 3, refundPercentage: 50 },
    ],
  },
  {
    code: 'GW',
    name: 'Gulf Wings',
    extraBaggagePolicy: {
      pricePerBagMinorUnits: 90_000,
      maxExtraBagsPerPassenger: 1,
    },
    cancellationTiers: [{ daysBeforeDeparture: 7, refundPercentage: 80 }],
  },
];

/** Each route runs both ways; times are local to the departure airport. */
const ROUTES = [
  {
    airline: 'NA',
    number: 'NA101',
    from: 'CAI',
    to: 'DXB',
    time: '09:30',
    hours: 3.5,
    fare: 650_000,
  },
  {
    airline: 'NA',
    number: 'NA102',
    from: 'DXB',
    to: 'CAI',
    time: '15:00',
    hours: 4,
    fare: 650_000,
  },
  {
    airline: 'NA',
    number: 'NA201',
    from: 'CAI',
    to: 'LHR',
    time: '08:00',
    hours: 5.5,
    fare: 1_400_000,
  },
  {
    airline: 'NA',
    number: 'NA202',
    from: 'LHR',
    to: 'CAI',
    time: '14:30',
    hours: 5,
    fare: 1_400_000,
  },
  {
    airline: 'GW',
    number: 'GW301',
    from: 'CAI',
    to: 'CDG',
    time: '11:15',
    hours: 4.75,
    fare: 1_200_000,
  },
  {
    airline: 'GW',
    number: 'GW302',
    from: 'CDG',
    to: 'CAI',
    time: '17:45',
    hours: 4.5,
    fare: 1_200_000,
  },
];

/** Days from today on which every route flies. */
const FLIGHT_DAYS = [14, 21, 28, 35, 42];

const HOTELS = [
  {
    name: 'Nile View Hotel',
    cityId: 'cairo',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
    address: '12 Corniche El Nil, Garden City',
    description: 'Riverside rooms ten minutes from Tahrir Square.',
    starClass: 4,
    amenities: ['Wi-Fi', 'Pool', 'Breakfast'],
    rooms: [
      ['101', 'Single', 1, 1, 180_000],
      ['204', 'Double', 1, 2, 250_000],
      ['305', 'Family', 3, 4, 420_000],
    ],
  },
  {
    name: 'Marina Bay Suites',
    cityId: 'dubai',
    countryCode: 'AE',
    timeZone: 'Asia/Dubai',
    address: 'Dubai Marina Walk',
    description: 'Suites with marina views and a rooftop pool.',
    starClass: 5,
    amenities: ['Wi-Fi', 'Pool', 'Gym'],
    rooms: [
      ['1201', 'Double', 1, 2, 900_000],
      ['1405', 'Suite', 2, 3, 1_500_000],
    ],
  },
  {
    name: 'Thames Court',
    cityId: 'london',
    countryCode: 'GB',
    timeZone: 'Europe/London',
    address: '5 Riverside Walk, South Bank',
    description: 'A short walk from the London Eye.',
    starClass: 3,
    amenities: ['Wi-Fi', 'Breakfast'],
    rooms: [
      ['12', 'Double', 1, 2, 700_000],
      ['14', 'Twin', 2, 2, 650_000],
    ],
  },
] as const;

export async function seedDemoData(connection: Connection) {
  const airlines = connection.model(Airline.name, AirlineSchema);
  const airports = connection.model(Airport.name, AirportSchema);
  const flights = connection.model(Flight.name, FlightSchema);
  const cabins = connection.model(CabinInventory.name, CabinInventorySchema);
  const hotels = connection.model(Hotel.name, HotelSchema);
  const rooms = connection.model(Room.name, RoomSchema);
  const availability = connection.model(
    RoomAvailability.name,
    RoomAvailabilitySchema,
  );

  const airlineIds = new Map<string, Types.ObjectId>();
  for (const airline of AIRLINES) {
    const saved = await airlines
      .findOneAndUpdate(
        { code: airline.code },
        { $set: airline, $setOnInsert: { isActive: true } },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();
    airlineIds.set(airline.code, saved._id);
  }

  const airportByCode = new Map(
    (await airports.find().lean().exec()).map((a) => [a.iataCode, a]),
  );
  let flightCount = 0;
  for (const route of ROUTES) {
    const from = airportByCode.get(route.from);
    const to = airportByCode.get(route.to);
    if (!from || !to)
      throw new Error(
        `Airport ${route.from} or ${route.to} is missing. Run seed:reference first.`,
      );
    for (const offset of FLIGHT_DAYS) {
      const localDate = addDays(hotelNow(from.timeZone).date, offset);
      const departureAt = airportLocalToUtc(
        `${localDate}T${route.time}`,
        from.timeZone,
      );
      const flight = await flights
        .findOneAndUpdate(
          {
            airlineId: airlineIds.get(route.airline),
            flightNumber: route.number,
            departureLocalDate: localDate,
          },
          {
            $setOnInsert: {
              departureAirportId: from._id,
              arrivalAirportId: to._id,
              departureAt,
              arrivalAt: new Date(
                departureAt.getTime() + route.hours * 3_600_000,
              ),
              status: FlightStatus.SCHEDULED,
            },
          },
          { upsert: true, returnDocument: 'after', runValidators: true },
        )
        .exec();
      for (const [cabinClass, seats, fare] of [
        [CabinClass.ECONOMY, 120, route.fare],
        [CabinClass.BUSINESS, 16, route.fare * 3],
      ] as const)
        await cabins
          .updateOne(
            { flightId: flight._id, cabinClass },
            {
              $setOnInsert: {
                totalSeats: seats,
                heldSeats: 0,
                bookedSeats: 0,
                priceMinorUnits: fare,
                freeBagCount: cabinClass === CabinClass.ECONOMY ? 1 : 2,
                maxBagWeightKg: cabinClass === CabinClass.ECONOMY ? 23 : 32,
              },
            },
            { upsert: true },
          )
          .exec();
      flightCount++;
    }
  }

  let roomCount = 0;
  for (const hotel of HOTELS) {
    const { rooms: roomRows, ...profile } = hotel;
    const saved = await hotels
      .findOneAndUpdate(
        { name: profile.name, cityId: profile.cityId },
        {
          $set: {
            ...profile,
            amenities: [...profile.amenities],
            policy: {
              checkInTime: '14:00',
              checkOutTime: '12:00',
              cancellationTiers: [
                { daysBeforeCheckIn: 14, refundPercentage: 100 },
                { daysBeforeCheckIn: 2, refundPercentage: 50 },
              ],
            },
          },
          $setOnInsert: { isActive: true, photos: [] },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();
    const today = hotelNow(profile.timeZone).date;
    for (const [label, roomType, bedCount, maxOccupancy, price] of roomRows) {
      const room = await rooms
        .findOneAndUpdate(
          { hotelId: saved._id, label },
          {
            $setOnInsert: {
              roomType,
              bedCount,
              maxOccupancy,
              nightlyPriceMinorUnits: price,
              isActive: true,
            },
          },
          { upsert: true, returnDocument: 'after', runValidators: true },
        )
        .exec();
      // Bookable from tomorrow for six months; existing ranges are kept.
      const record = await availability.findOne({ roomId: room._id }).exec();
      if (!record)
        await availability.create({
          roomId: room._id,
          bookableRanges: [
            { fromDate: addDays(today, 1), untilDate: addDays(today, 181) },
          ],
        });
      roomCount++;
    }
  }

  return {
    airlines: AIRLINES.length,
    flights: flightCount,
    hotels: HOTELS.length,
    rooms: roomCount,
  };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Set MONGODB_URI in backend/.env before seeding.');
    process.exitCode = 1;
    return;
  }
  const connection = createConnection();
  try {
    await connection.openUri(uri, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 8000,
    });
    const result = await seedDemoData(connection);
    console.log(
      `Demo data ready: ${result.airlines} airlines, ${result.flights} flights, ` +
        `${result.hotels} hotels, ${result.rooms} rooms.`,
    );
  } catch (error) {
    console.error(
      `Demo data seed failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  void main();
}
