import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../common/booking-status';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { addDays } from '../hotels/hotel-dates';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { DELETED_USER } from '../reviews/reviews.service';
import { User, UserStatus } from '../users/schemas/user.schema';
import {
  CityGroupDto,
  ItineraryDetailsDto,
  ItinerarySummaryDto,
} from './dto/itinerary-responses.dto';
import { Itinerary } from './schemas/itinerary.schema';

/** A stored itinerary as returned by lean queries (subdocuments keep _id). */
export type StoredItinerary = Itinerary & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

type Named = { _id: Types.ObjectId };

/** ITN-27: the booking facts shown on a day and counted in the budget. */
export interface LinkedBookingInfo {
  bookingType: 'flight' | 'hotel';
  reference?: string;
  status: string;
  title: string;
  amountMinorUnits: number;
  currency: string;
}

/** Only confirmed or completed bookings feed the budget (ITN-27). */
export function countsInBudget(status: string): boolean {
  return (
    status === BookingStatus.CONFIRMED || status === BookingStatus.COMPLETED
  );
}

/** ITN-05: day N falls N − 1 days after the start date. */
export function dayDate(startDate: string, index: number): string {
  return addDays(startDate, index);
}

/** ITN-09: consecutive days in the same city form one group. */
export function cityGroups(
  itinerary: Pick<Itinerary, 'startDate' | 'days'>,
  cityName: (id: string) => string,
): CityGroupDto[] {
  const groups: CityGroupDto[] = [];
  itinerary.days.forEach((day, index) => {
    const last = groups.at(-1);
    if (last && last.cityId === day.cityId) {
      last.lastDay = index + 1;
      last.dayCount++;
      last.endDate = dayDate(itinerary.startDate, index);
      return;
    }
    groups.push({
      number: groups.length + 1,
      cityId: day.cityId,
      cityName: cityName(day.cityId),
      firstDay: index + 1,
      lastDay: index + 1,
      dayCount: 1,
      startDate: dayDate(itinerary.startDate, index),
      endDate: dayDate(itinerary.startDate, index),
    });
  });
  return groups;
}

/** Turns stored itineraries into API responses, with names looked up once. */
@Injectable()
export class ItineraryPresenter {
  constructor(
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
  ) {}

  async names(itineraries: StoredItinerary[]) {
    const cityIds = new Set<string>();
    const countryCodes = new Set<string>();
    const userIds: Types.ObjectId[] = [];
    for (const itinerary of itineraries) {
      itinerary.countryCodes.forEach((code) => countryCodes.add(code));
      userIds.push(itinerary.ownerId);
      if (itinerary.clonedFrom)
        userIds.push(itinerary.clonedFrom.originalAuthorId);
      for (const day of itinerary.days) {
        cityIds.add(day.cityId);
        for (const transport of day.transportCosts) {
          cityIds.add(transport.fromCityId);
          cityIds.add(transport.toCityId);
        }
      }
    }
    const links = itineraries.flatMap((i) =>
      i.days.flatMap((d) => d.linkedBookings ?? []),
    );
    const idsOf = (model: string) =>
      links.filter((l) => l.bookingModel === model).map((l) => l.bookingId);
    const [flightBookings, hotelBookings] = await Promise.all([
      this.flightBookings
        .find({ _id: { $in: idsOf('FlightBooking') } })
        .select('reference status totalMinorUnits currency segments.flightId')
        .lean()
        .exec(),
      this.hotelBookings
        .find({ _id: { $in: idsOf('HotelBooking') } })
        .select(
          'reference status totalMinorUnits currency hotelId checkInDate checkOutDate',
        )
        .lean()
        .exec(),
    ]);
    const [bookedFlights, bookedHotels] = await Promise.all([
      this.flights
        .find({
          _id: {
            $in: flightBookings.flatMap((b) =>
              b.segments.map((s) => s.flightId),
            ),
          },
        })
        .select('flightNumber')
        .lean()
        .exec(),
      this.hotels
        .find({ _id: { $in: hotelBookings.map((b) => b.hotelId) } })
        .select('name')
        .lean()
        .exec(),
    ]);
    const flightNumber = new Map(
      bookedFlights.map((f) => [f._id.toString(), f.flightNumber]),
    );
    const hotelName = new Map(
      bookedHotels.map((h) => [h._id.toString(), h.name]),
    );
    const bookingById = new Map<string, LinkedBookingInfo>();
    for (const b of flightBookings)
      bookingById.set(b._id.toString(), {
        bookingType: 'flight',
        reference: b.reference,
        status: b.status,
        title: `Flight ${b.segments
          .map((s) => flightNumber.get(s.flightId.toString()) ?? '')
          .filter(Boolean)
          .join(' + ')}`,
        amountMinorUnits: b.totalMinorUnits,
        currency: b.currency,
      });
    for (const b of hotelBookings)
      bookingById.set(b._id.toString(), {
        bookingType: 'hotel',
        reference: b.reference,
        status: b.status,
        title: `${hotelName.get(b.hotelId.toString()) ?? 'Hotel'}, ${b.checkInDate} to ${b.checkOutDate}`,
        amountMinorUnits: b.totalMinorUnits,
        currency: b.currency,
      });

    const [cities, countries, users] = await Promise.all([
      this.cities
        .find({ _id: { $in: [...cityIds] } })
        .lean()
        .exec(),
      this.countries
        .find({ _id: { $in: [...countryCodes] } })
        .lean()
        .exec(),
      this.users
        .find({ _id: { $in: userIds } })
        .select('name status')
        .lean()
        .exec(),
    ]);
    const cityById = new Map(cities.map((c) => [c._id, c]));
    const countryName = new Map(countries.map((c) => [c._id, c.name]));
    const userName = new Map(
      users.map((u) => [
        u._id.toString(),
        u.status === UserStatus.DEACTIVATED ? DELETED_USER : u.name,
      ]),
    );
    return {
      city: (id: string) => cityById.get(id)?.name ?? id,
      cityCountry: (id: string) => cityById.get(id)?.countryCode ?? '',
      country: (code: string) => countryName.get(code) ?? code,
      user: (id: Types.ObjectId) => userName.get(id.toString()) ?? DELETED_USER,
      booking: (id: Types.ObjectId) => bookingById.get(id.toString()),
    };
  }

  summary(
    itinerary: StoredItinerary,
    names: Awaited<ReturnType<ItineraryPresenter['names']>>,
  ): Pick<ItinerarySummaryDto, keyof ItinerarySummaryDto> {
    return {
      id: itinerary._id.toString(),
      title: itinerary.title,
      countryCodes: itinerary.countryCodes,
      countryNames: itinerary.countryCodes.map(names.country),
      startDate: itinerary.startDate,
      endDate: itinerary.days.length
        ? dayDate(itinerary.startDate, itinerary.days.length - 1)
        : undefined,
      dayCount: itinerary.days.length,
      visibility: itinerary.visibility,
      updatedAt: itinerary.updatedAt,
    };
  }

  async details(
    itinerary: StoredItinerary,
  ): Promise<Pick<ItineraryDetailsDto, keyof ItineraryDetailsDto>> {
    const names = await this.names([itinerary]);
    const id = (value: { _id?: Types.ObjectId }) => value._id!.toString();
    return {
      ...this.summary(itinerary, names),
      days: itinerary.days.map((day, index) => ({
        id: id(day as unknown as Named),
        number: index + 1,
        date: dayDate(itinerary.startDate, index),
        cityId: day.cityId,
        cityName: names.city(day.cityId),
        countryCode: names.cityCountry(day.cityId),
        notes: day.notes ?? undefined,
        activities: day.activities.map((activity) => ({
          id: id(activity as unknown as Named),
          name: activity.name,
          description: activity.description,
          localTime: activity.localTime ?? undefined,
          cost: activity.cost
            ? {
                amountMinorUnits: activity.cost.amountMinorUnits,
                currency: activity.cost.currency,
              }
            : undefined,
          images: activity.images.map((image) => ({
            id: id(image as unknown as Named),
            url: image.url,
          })),
        })),
        budgetEntries: day.budgetEntries.map((entry) => ({
          id: id(entry as unknown as Named),
          category: entry.category,
          description: entry.description ?? undefined,
          amountMinorUnits: entry.amountMinorUnits,
          currency: entry.currency,
        })),
        linkedBookings: (day.linkedBookings ?? []).flatMap((link) => {
          const booking = names.booking(link.bookingId);
          return booking
            ? [
                {
                  id: id(link as unknown as Named),
                  bookingId: link.bookingId.toString(),
                  ...booking,
                  countsInBudget: countsInBudget(booking.status),
                },
              ]
            : [];
        }),
        transportCosts: day.transportCosts.map((transport) => ({
          id: id(transport as unknown as Named),
          mode: transport.mode,
          fromCityId: transport.fromCityId,
          fromCityName: names.city(transport.fromCityId),
          toCityId: transport.toCityId,
          toCityName: names.city(transport.toCityId),
          amountMinorUnits: transport.amountMinorUnits,
          currency: transport.currency,
        })),
      })),
      groups: cityGroups(itinerary, names.city),
      clonedFrom: itinerary.clonedFrom
        ? {
            sourceItineraryId:
              itinerary.clonedFrom.sourceItineraryId.toString(),
            originalAuthorId: itinerary.clonedFrom.originalAuthorId.toString(),
            originalAuthorName: names.user(
              itinerary.clonedFrom.originalAuthorId,
            ),
          }
        : undefined,
      createdAt: itinerary.createdAt,
    };
  }

  async authorName(itinerary: StoredItinerary): Promise<string> {
    return (await this.names([itinerary])).user(itinerary.ownerId);
  }
}
