import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/currency';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { City } from '../reference-data/schemas/city.schema';
import { Review } from '../reviews/schemas/review.schema';
import {
  HotelSearchItemDto,
  HotelSearchResultDto,
  HotelSort,
  HotelSortOrder,
  SearchHotelsQueryDto,
} from './dto/hotel-search.dto';
import { hotelNow, nightsBetween } from './hotel-dates';
import { occupyingReservation, roomIsFree } from './rooms.service';
import { Hotel } from './schemas/hotel.schema';
import { RoomAvailability } from './schemas/room-availability.schema';
import { Room } from './schemas/room.schema';

/**
 * True when `count` of the free rooms can host the guests: the rooms with
 * the largest occupancy decide (HTL-11).
 */
export function roomsCanHost(
  occupancies: number[],
  count: number,
  guests: number,
): boolean {
  if (occupancies.length < count) return false;
  const best = [...occupancies].sort((a, b) => b - a).slice(0, count);
  return best.reduce((sum, value) => sum + value, 0) >= guests;
}

/** HTL-11, HTL-12: active hotels with enough free rooms for the stay. */
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailability>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(City.name) private readonly cities: Model<City>,
  ) {}

  async search(
    query: SearchHotelsQueryDto,
    now = new Date(),
  ): Promise<HotelSearchResultDto> {
    if (!query.cityId && !query.countryCode)
      throw new BadRequestException('Send a cityId or a countryCode.');
    const stay = { fromDate: query.checkInDate, untilDate: query.checkOutDate };
    if (stay.untilDate <= stay.fromDate)
      throw new BadRequestException('Check-out must be after check-in.');
    // UTC-12 is the last place on Earth to reach a date: a check-in before
    // its date is in the past for every hotel.
    if (stay.fromDate < hotelNow('Etc/GMT+12', now).date)
      throw new BadRequestException('Check-in cannot be in the past.');
    if (
      query.minPriceMinorUnits !== undefined &&
      query.maxPriceMinorUnits !== undefined &&
      query.minPriceMinorUnits > query.maxPriceMinorUnits
    )
      throw new BadRequestException(
        'The minimum price cannot be greater than the maximum price.',
      );
    if (query.guests < query.rooms)
      throw new BadRequestException('Each room needs at least one guest.');

    const nights = nightsBetween(stay.fromDate, stay.untilDate);
    const hotels = await this.hotels
      .find({
        isActive: true,
        // Bookings copy the policy, so hotels without one cannot be booked.
        policy: { $exists: true },
        ...(query.cityId ? { cityId: query.cityId } : {}),
        ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      })
      .lean()
      .exec();
    // Check-in must not be in the past in the hotel's own calendar.
    const open = hotels.filter(
      (hotel) => stay.fromDate >= hotelNow(hotel.timeZone, now).date,
    );
    const hotelIds = open.map((hotel) => hotel._id);

    const rooms = await this.rooms
      .find({ hotelId: { $in: hotelIds }, isActive: true })
      .lean()
      .exec();
    const roomIds = rooms.map((room) => room._id);
    const [availability, taken, ratings, cities] = await Promise.all([
      this.availability
        .find({ roomId: { $in: roomIds } })
        .lean()
        .exec(),
      this.bookings
        .find({
          'rooms.roomId': { $in: roomIds },
          checkInDate: { $lt: stay.untilDate },
          checkOutDate: { $gt: stay.fromDate },
          ...occupyingReservation(now),
        })
        .select('rooms.roomId')
        .lean()
        .exec(),
      this.ratings(hotelIds),
      this.cities
        .find({ _id: { $in: [...new Set(open.map((hotel) => hotel.cityId))] } })
        .lean()
        .exec(),
    ]);
    const availabilityByRoom = new Map(
      availability.map((record) => [record.roomId.toString(), record]),
    );
    const takenIds = new Set(
      taken.flatMap((booking) =>
        booking.rooms.map((reserved) => reserved.roomId.toString()),
      ),
    );
    const cityNames = new Map(cities.map((city) => [city._id, city.name]));

    const matches: HotelSearchItemDto[] = [];
    for (const hotel of open) {
      const free = rooms.filter((room) => {
        const record = availabilityByRoom.get(room._id.toString());
        return (
          room.hotelId.equals(hotel._id) &&
          !!record &&
          roomIsFree(room, record, stay, takenIds.has(room._id.toString()))
        );
      });
      if (
        !roomsCanHost(
          free.map((room) => room.maxOccupancy),
          query.rooms,
          query.guests,
        )
      )
        continue;
      const cheapest = Math.min(...free.map((r) => r.nightlyPriceMinorUnits));
      const rating = ratings.get(hotel._id.toString());
      if (
        (query.minPriceMinorUnits !== undefined &&
          cheapest < query.minPriceMinorUnits) ||
        (query.maxPriceMinorUnits !== undefined &&
          cheapest > query.maxPriceMinorUnits) ||
        (query.minRating !== undefined &&
          (!rating || rating.average < query.minRating))
      )
        continue;
      matches.push({
        id: hotel._id.toString(),
        name: hotel.name,
        address: hotel.address,
        cityId: hotel.cityId,
        cityName: cityNames.get(hotel.cityId) ?? hotel.cityId,
        countryCode: hotel.countryCode,
        starClass: hotel.starClass,
        amenities: hotel.amenities,
        photoUrl: hotel.photos[0]?.url,
        cheapestNightlyPriceMinorUnits: cheapest,
        cheapestStayPriceMinorUnits: cheapest * nights,
        freeRoomCount: free.length,
        averageRating: rating?.average,
        ratingCount: rating?.count ?? 0,
      });
    }

    const sortBy = query.sortBy ?? HotelSort.PRICE;
    const order =
      query.sortOrder ??
      (sortBy === HotelSort.RATING ? HotelSortOrder.DESC : HotelSortOrder.ASC);
    const direction = order === HotelSortOrder.ASC ? 1 : -1;
    matches.sort((a, b) => {
      if (sortBy === HotelSort.RATING) {
        // Unrated hotels always come last.
        if (a.averageRating === undefined || b.averageRating === undefined)
          return (
            (a.averageRating === undefined ? 1 : 0) -
              (b.averageRating === undefined ? 1 : 0) ||
            a.id.localeCompare(b.id)
          );
        if (a.averageRating !== b.averageRating)
          return (a.averageRating - b.averageRating) * direction;
      } else if (
        a.cheapestNightlyPriceMinorUnits !== b.cheapestNightlyPriceMinorUnits
      ) {
        return (
          (a.cheapestNightlyPriceMinorUnits -
            b.cheapestNightlyPriceMinorUnits) *
          direction
        );
      }
      return a.id.localeCompare(b.id);
    });

    const page = query.page ?? 1;
    return {
      checkInDate: stay.fromDate,
      checkOutDate: stay.untilDate,
      nights,
      currency: PLATFORM_CURRENCY,
      ...pageInfo(page, matches.length),
      items: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    };
  }

  /** Visible-review averages (one decimal) and counts per hotel. */
  private async ratings(hotelIds: Types.ObjectId[]) {
    const rows = await this.reviews
      .aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
        { $match: { hotelId: { $in: hotelIds }, hiddenAt: null } },
        {
          $group: {
            _id: '$hotelId',
            average: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    return new Map(
      rows.map((row) => [
        row._id.toString(),
        { average: Math.round(row.average * 10) / 10, count: row.count },
      ]),
    );
  }
}
