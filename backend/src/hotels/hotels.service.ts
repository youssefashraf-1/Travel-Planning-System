import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { ReviewsService } from '../reviews/reviews.service';
import { User } from '../users/schemas/user.schema';
import {
  CreateHotelDto,
  HotelPoliciesDto,
  HotelReservationsQueryDto,
  OptionalStayQueryDto,
  UpdateHotelDto,
} from './dto/hotel-requests.dto';
import {
  HotelDetailsDto,
  HotelDto,
  HotelReservationListDto,
} from './dto/hotel-responses.dto';
import { definedFields, RoomsService } from './rooms.service';
import { Hotel } from './schemas/hotel.schema';

type StoredHotel = Hotel & { _id: Types.ObjectId };

/** HTL-01, HTL-02, HTL-09, HTL-10, HTL-22: hotel profiles and policies. */
@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly rooms: RoomsService,
    private readonly reviews: ReviewsService,
  ) {}

  /** HTL-01: admins create hotel profiles in a seeded city. */
  async create(dto: CreateHotelDto): Promise<HotelDto> {
    await this.checkLocation(dto.cityId, dto.countryCode);
    const hotel = await this.hotels.create(dto);
    return this.present(hotel.toObject());
  }

  /** HTL-01: the hotel's own moderator edits the profile. */
  async update(id: string, dto: UpdateHotelDto): Promise<HotelDto> {
    if (Object.keys(definedFields(dto)).length === 0)
      throw new BadRequestException('Send at least one field to change.');
    const hotel = await this.findDocument(id);
    if (dto.cityId !== undefined || dto.countryCode !== undefined)
      await this.checkLocation(
        dto.cityId ?? hotel.cityId,
        dto.countryCode ?? hotel.countryCode,
      );
    hotel.set(definedFields(dto));
    await hotel.save();
    return this.present(hotel.toObject());
  }

  /**
   * HTL-09, HTL-10: check-in and check-out times and cancellation tiers.
   * Existing reservations keep the policy they accepted.
   */
  async setPolicies(id: string, dto: HotelPoliciesDto): Promise<HotelDto> {
    const thresholds = dto.cancellationTiers.map((t) => t.daysBeforeCheckIn);
    if (new Set(thresholds).size !== thresholds.length)
      throw new BadRequestException(
        'Each cancellation tier needs a different daysBeforeCheckIn.',
      );
    const hotel = await this.findDocument(id);
    hotel.set('policy', {
      checkInTime: dto.checkInTime,
      checkOutTime: dto.checkOutTime,
      cancellationTiers: [...dto.cancellationTiers].sort(
        (a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn,
      ),
    });
    await hotel.save();
    return this.present(hotel.toObject());
  }

  /**
   * HTL-02: the public hotel page with rating, newest reviews, and free
   * rooms when dates are given.
   */
  async details(
    id: string,
    query: OptionalStayQueryDto,
    now = new Date(),
  ): Promise<HotelDetailsDto> {
    if (!!query.checkInDate !== !!query.checkOutDate)
      throw new BadRequestException(
        'Send both checkInDate and checkOutDate to see free rooms.',
      );
    const hotel = await this.findLean(id);
    const [summary, latestReviews, availability] = await Promise.all([
      this.reviews.ratingSummary(hotel._id),
      this.reviews.latest(hotel._id, 1, 5),
      query.checkInDate && query.checkOutDate
        ? this.rooms.availableRooms(
            id,
            {
              checkInDate: query.checkInDate,
              checkOutDate: query.checkOutDate,
            },
            now,
          )
        : undefined,
    ]);
    return {
      ...(await this.present(hotel)),
      ...summary,
      latestReviews,
      availability,
    };
  }

  /** HTL-22: the hotel's reservations with guest names, newest stays first. */
  async reservations(
    id: string,
    query: HotelReservationsQueryDto,
  ): Promise<HotelReservationListDto> {
    const hotel = await this.findLean(id);
    const page = query.page ?? 1;
    const filter = {
      hotelId: hotel._id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [bookings, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ checkInDate: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const guests = await this.users
      .find({ _id: { $in: bookings.map((b) => b.userId) } })
      .select('name')
      .lean()
      .exec();
    const nameById = new Map(guests.map((g) => [g._id.toString(), g.name]));
    return {
      ...pageInfo(page, total),
      items: bookings.map((booking) => ({
        id: booking._id.toString(),
        reference: booking.reference,
        status: booking.status,
        guestName: nameById.get(booking.userId.toString()) ?? 'Unknown guest',
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        rooms: booking.rooms.map((room) => ({
          roomId: room.roomId.toString(),
          label: room.label,
          adults: room.adults,
          children: room.childAges.length,
        })),
        totalMinorUnits: booking.totalMinorUnits,
        currency: booking.currency,
      })),
    };
  }

  /** The profile plus rating summary, as shown after create or edit. */
  async present(hotel: StoredHotel): Promise<Pick<HotelDto, keyof HotelDto>> {
    const [city, country, summary] = await Promise.all([
      this.cities.findById(hotel.cityId).lean().exec(),
      this.countries.findById(hotel.countryCode).lean().exec(),
      this.reviews.ratingSummary(hotel._id),
    ]);
    return {
      id: hotel._id.toString(),
      name: hotel.name,
      address: hotel.address,
      cityId: hotel.cityId,
      cityName: city?.name ?? hotel.cityId,
      countryCode: hotel.countryCode,
      countryName: country?.name ?? hotel.countryCode,
      timeZone: hotel.timeZone,
      description: hotel.description,
      starClass: hotel.starClass,
      amenities: hotel.amenities,
      photoUrls: hotel.photos.map((photo) => photo.url),
      photos: hotel.photos.map((photo) => ({
        id: (photo as typeof photo & { _id: Types.ObjectId })._id.toString(),
        url: photo.url,
      })),
      policy: hotel.policy && {
        checkInTime: hotel.policy.checkInTime,
        checkOutTime: hotel.policy.checkOutTime,
        cancellationTiers: hotel.policy.cancellationTiers.map((tier) => ({
          daysBeforeCheckIn: tier.daysBeforeCheckIn,
          refundPercentage: tier.refundPercentage,
        })),
      },
      isActive: hotel.isActive,
      canBook: hotel.isActive && !!hotel.policy,
      ...summary,
    };
  }

  private async checkLocation(cityId: string, countryCode: string) {
    const city = await this.cities.findById(cityId).lean().exec();
    if (!city)
      throw new BadRequestException(
        'Choose a city from the reference list (GET the seeded cities).',
      );
    if (city.countryCode !== countryCode)
      throw new BadRequestException(
        `${city.name} is in ${city.countryCode}, not ${countryCode}.`,
      );
  }

  private async findDocument(id: string) {
    const hotel = Types.ObjectId.isValid(id)
      ? await this.hotels.findById(id).exec()
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found.');
    return hotel;
  }

  private async findLean(id: string): Promise<StoredHotel> {
    const hotel = Types.ObjectId.isValid(id)
      ? await this.hotels.findById(id).lean().exec()
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found.');
    return hotel;
  }
}
