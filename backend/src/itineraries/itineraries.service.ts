import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Error as MongooseError,
  HydratedDocument,
  Model,
  Types,
} from 'mongoose';
import { assertOwnedBy } from '../auth/access';
import { PAGE_SIZE, pageInfo, PageQueryDto } from '../common/pagination';
import {
  ImageUploadsService,
  UploadedImage,
} from '../common/uploads/image-uploads.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { BookingStatus } from '../common/booking-status';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { definedFields } from '../hotels/rooms.service';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { UserDocument } from '../users/schemas/user.schema';
import {
  CreateActivityDto,
  CreateBudgetDto,
  CreateDayDto,
  CreateItineraryDto,
  CreateTransportCostDto,
  LinkBookingDto,
  MAX_DAYS,
  ReorderDaysDto,
  UpdateActivityDto,
  UpdateBudgetDto,
  UpdateDayDto,
  UpdateItineraryDto,
  UpdateTransportCostDto,
} from './dto/itinerary-requests.dto';
import {
  ItineraryDetailsDto,
  ItineraryListDto,
} from './dto/itinerary-responses.dto';
import {
  dayDate,
  ItineraryPresenter,
  StoredItinerary,
} from './itinerary-presenter';
import { Activity } from './schemas/activity.schema';
import { BudgetEntry } from './schemas/budget-entry.schema';
import { ItineraryDay, LinkedBooking } from './schemas/itinerary-day.schema';
import { Itinerary } from './schemas/itinerary.schema';
import { TransportCost } from './schemas/transport-cost.schema';

type ItineraryDoc = HydratedDocument<Itinerary>;
type Sub<T> = Types.Subdocument<Types.ObjectId> & T & { _id: Types.ObjectId };
/** A day as a subdocument, with its lists as document arrays. */
type DayDoc = Sub<
  Omit<
    ItineraryDay,
    'activities' | 'budgetEntries' | 'transportCosts' | 'linkedBookings'
  >
> & {
  activities: Types.DocumentArray<Sub<Activity>>;
  budgetEntries: Types.DocumentArray<Sub<BudgetEntry>>;
  transportCosts: Types.DocumentArray<Sub<TransportCost>>;
  linkedBookings: Types.DocumentArray<Sub<LinkedBooking>>;
};

function daysOf(itinerary: ItineraryDoc): Types.DocumentArray<DayDoc> {
  return itinerary.days as unknown as Types.DocumentArray<DayDoc>;
}
const NOT_FOUND = 'Itinerary not found.';
const MAX_IMAGES = 5;

/**
 * ITN-01 to ITN-16, ITN-20: an owner's itineraries, days, activities,
 * images, budget entries and transport costs. Every change checks that
 * the signed-in user owns the itinerary (anyone else gets 404) and saves
 * with a version check, so two edits at once cannot overwrite each other.
 */
@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    private readonly presenter: ItineraryPresenter,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly uploads: ImageUploadsService,
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
  ) {}

  /** ITN-01: private by default. */
  async create(
    user: UserDocument,
    dto: CreateItineraryDto,
  ): Promise<ItineraryDetailsDto> {
    await this.assertCountries(dto.countryCodes);
    const itinerary = await this.itineraries.create({
      ownerId: user._id,
      title: dto.title,
      countryCodes: dto.countryCodes,
      startDate: dto.startDate,
    });
    return this.present(itinerary);
  }

  /** ITN-03: most recently updated first, 10 per page. */
  async listMine(
    user: UserDocument,
    query: PageQueryDto,
  ): Promise<ItineraryListDto> {
    const page = query.page ?? 1;
    const filter = { ownerId: user._id };
    const [items, total] = await Promise.all([
      this.itineraries
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<StoredItinerary[]>()
        .exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    const names = await this.presenter.names(items);
    return {
      ...pageInfo(page, total),
      items: items.map((item) => this.presenter.summary(item, names)),
    };
  }

  async details(user: UserDocument, id: string): Promise<ItineraryDetailsDto> {
    return this.present(await this.own(user, id));
  }

  /** ITN-01, ITN-20: title, countries, start date and visibility. */
  async update(
    user: UserDocument,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryDetailsDto> {
    const changes = definedFields(dto);
    if (Object.keys(changes).length === 0)
      throw new BadRequestException('Send at least one field to change.');
    const itinerary = await this.own(user, id);
    if (changes.countryCodes) {
      await this.assertCountries(changes.countryCodes);
      const used = await this.cities
        .find({ _id: { $in: itinerary.days.map((day) => day.cityId) } })
        .lean()
        .exec();
      const orphaned = used.filter(
        (city) => !changes.countryCodes!.includes(city.countryCode),
      );
      if (orphaned.length > 0)
        throw new BadRequestException(
          `Days are planned in ${orphaned.map((c) => c.name).join(', ')}; keep ${[...new Set(orphaned.map((c) => c.countryCode))].join(', ')} or change those days first.`,
        );
    }
    itinerary.set(changes);
    return this.save(itinerary);
  }

  /** ITN-01: clones made by others are separate documents and stay. */
  async remove(user: UserDocument, id: string): Promise<void> {
    const itinerary = await this.own(user, id);
    const imageUrls = itinerary.days.flatMap((day) =>
      day.activities.flatMap((activity) => activity.images.map((i) => i.url)),
    );
    await itinerary.deleteOne();
    await Promise.all(imageUrls.map((url) => this.uploads.remove(url)));
  }

  /** ITN-05: days are appended and numbered in order; at most 60. */
  async addDay(
    user: UserDocument,
    id: string,
    dto: CreateDayDto,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    if (itinerary.days.length >= MAX_DAYS)
      throw new BadRequestException(
        `An itinerary can have at most ${MAX_DAYS} days.`,
      );
    await this.assertCity(dto.cityId, itinerary.countryCodes);
    itinerary.days.push({
      cityId: dto.cityId,
      notes: dto.notes ?? undefined,
      activities: [],
      budgetEntries: [],
      transportCosts: [],
      linkedBookings: [],
    });
    return this.save(itinerary);
  }

  async updateDay(
    user: UserDocument,
    id: string,
    dayId: string,
    dto: UpdateDayDto,
  ): Promise<ItineraryDetailsDto> {
    const changes = definedFields(dto);
    if (Object.keys(changes).length === 0)
      throw new BadRequestException('Send a cityId or notes.');
    const itinerary = await this.own(user, id);
    const day = this.findDay(itinerary, dayId);
    if (changes.cityId !== undefined) {
      await this.assertCity(changes.cityId, itinerary.countryCodes);
      day.cityId = changes.cityId;
    }
    if (changes.notes !== undefined) day.notes = changes.notes ?? undefined;
    return this.save(itinerary);
  }

  /** ITN-07: the remaining days renumber and their dates move up. */
  async removeDay(
    user: UserDocument,
    id: string,
    dayId: string,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    const day = this.findDay(itinerary, dayId);
    const imageUrls = day.activities.flatMap((a) => a.images.map((i) => i.url));
    day.deleteOne();
    const result = await this.save(itinerary);
    await Promise.all(imageUrls.map((url) => this.uploads.remove(url)));
    return result;
  }

  /** ITN-08: move one day; numbers, dates and groups follow the new order. */
  async reorder(
    user: UserDocument,
    id: string,
    dto: ReorderDaysDto,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    const from = daysOf(itinerary).findIndex((d) => d._id.equals(dto.dayId));
    if (from < 0) throw new NotFoundException('Day not found.');
    if (dto.position > itinerary.days.length)
      throw new BadRequestException(
        `position must be between 1 and ${itinerary.days.length}.`,
      );
    const days = daysOf(itinerary).map((day) => day.toObject());
    const [moved] = days.splice(from, 1);
    days.splice(dto.position - 1, 0, moved);
    itinerary.set('days', days);
    return this.save(itinerary);
  }

  /** ITN-10 */
  async addActivity(
    user: UserDocument,
    id: string,
    dayId: string,
    dto: CreateActivityDto,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    const day = this.findDay(itinerary, dayId);
    if (dto.cost) await this.exchangeRates.assertSupported(dto.cost.currency);
    day.activities.push({
      name: dto.name,
      description: dto.description,
      localTime: dto.localTime ?? undefined,
      cost: dto.cost ?? undefined,
      images: [],
    });
    return this.save(itinerary);
  }

  async updateActivity(
    user: UserDocument,
    activityId: string,
    dto: UpdateActivityDto,
  ): Promise<ItineraryDetailsDto> {
    const changes = definedFields(dto);
    if (Object.keys(changes).length === 0)
      throw new BadRequestException('Send at least one field to change.');
    const { itinerary, item } = await this.ownItem(
      user,
      'activities',
      activityId,
    );
    if (changes.cost)
      await this.exchangeRates.assertSupported(changes.cost.currency);
    for (const [key, value] of Object.entries(changes))
      item.set(key, value === null ? undefined : value);
    return this.save(itinerary);
  }

  async removeActivity(user: UserDocument, activityId: string): Promise<void> {
    const { itinerary, item } = await this.ownItem(
      user,
      'activities',
      activityId,
    );
    const urls = (item.get('images') as { url: string }[]).map((i) => i.url);
    item.deleteOne();
    await this.save(itinerary);
    await Promise.all(urls.map((url) => this.uploads.remove(url)));
  }

  /** ITN-12, GEN-08: up to 5 JPG or PNG images per activity. */
  async addImage(
    user: UserDocument,
    activityId: string,
    file: UploadedImage | undefined,
  ): Promise<ItineraryDetailsDto> {
    const { itinerary, item } = await this.ownItem(
      user,
      'activities',
      activityId,
    );
    const images = item.get('images') as { url: string }[];
    if (images.length >= MAX_IMAGES)
      throw new BadRequestException(
        `An activity can have at most ${MAX_IMAGES} images.`,
      );
    const url = await this.uploads.save(file, 'activities');
    images.push({ url });
    try {
      return await this.save(itinerary);
    } catch (error) {
      await this.uploads.remove(url);
      throw error;
    }
  }

  async removeImage(
    user: UserDocument,
    activityId: string,
    imageId: string,
  ): Promise<ItineraryDetailsDto> {
    const { itinerary, item } = await this.ownItem(
      user,
      'activities',
      activityId,
    );
    const images = item.get('images') as Types.DocumentArray<{ url: string }>;
    const image = Types.ObjectId.isValid(imageId) ? images.id(imageId) : null;
    if (!image) throw new NotFoundException('Image not found.');
    const url = image.url;
    image.deleteOne();
    const result = await this.save(itinerary);
    await this.uploads.remove(url);
    return result;
  }

  /** ITN-14 */
  async addBudget(
    user: UserDocument,
    id: string,
    dayId: string,
    dto: CreateBudgetDto,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    const day = this.findDay(itinerary, dayId);
    await this.exchangeRates.assertSupported(dto.currency);
    day.budgetEntries.push({
      category: dto.category,
      description: dto.description ?? undefined,
      amountMinorUnits: dto.amountMinorUnits,
      currency: dto.currency,
    });
    return this.save(itinerary);
  }

  async updateBudget(
    user: UserDocument,
    budgetId: string,
    dto: UpdateBudgetDto,
  ): Promise<ItineraryDetailsDto> {
    const changes = definedFields(dto);
    if (Object.keys(changes).length === 0)
      throw new BadRequestException('Send at least one field to change.');
    const { itinerary, item } = await this.ownItem(
      user,
      'budgetEntries',
      budgetId,
    );
    if (changes.currency)
      await this.exchangeRates.assertSupported(changes.currency);
    for (const [key, value] of Object.entries(changes))
      item.set(key, value === null ? undefined : value);
    return this.save(itinerary);
  }

  async removeBudget(user: UserDocument, budgetId: string): Promise<void> {
    const { itinerary, item } = await this.ownItem(
      user,
      'budgetEntries',
      budgetId,
    );
    item.deleteOne();
    await this.save(itinerary);
  }

  /** ITN-16: intercity transport on one day, between two different cities. */
  async addTransport(
    user: UserDocument,
    id: string,
    dto: CreateTransportCostDto,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    const day = this.findDay(itinerary, dto.dayId);
    await this.assertTransport(dto.fromCityId, dto.toCityId, dto.currency);
    day.transportCosts.push({
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amountMinorUnits: dto.amountMinorUnits,
      currency: dto.currency,
    });
    return this.save(itinerary);
  }

  async updateTransport(
    user: UserDocument,
    transportId: string,
    dto: UpdateTransportCostDto,
  ): Promise<ItineraryDetailsDto> {
    const changes = definedFields(dto);
    if (Object.keys(changes).length === 0)
      throw new BadRequestException('Send at least one field to change.');
    const { itinerary, day, item } = await this.ownItem(
      user,
      'transportCosts',
      transportId,
    );
    const current = item.toObject() as unknown as {
      fromCityId: string;
      toCityId: string;
      currency: string;
    };
    await this.assertTransport(
      changes.fromCityId ?? current.fromCityId,
      changes.toCityId ?? current.toCityId,
      changes.currency ?? current.currency,
    );
    const { dayId, ...fields } = changes;
    if (dayId && !day._id.equals(dayId)) {
      // Move the entry to another day of the same itinerary.
      const target = this.findDay(itinerary, dayId);
      const moved = { ...current, ...fields };
      item.deleteOne();
      target.transportCosts.push(moved);
    } else {
      for (const [key, value] of Object.entries(fields)) item.set(key, value);
    }
    return this.save(itinerary);
  }

  async removeTransport(
    user: UserDocument,
    transportId: string,
  ): Promise<void> {
    const { itinerary, item } = await this.ownItem(
      user,
      'transportCosts',
      transportId,
    );
    item.deleteOne();
    await this.save(itinerary);
  }

  /**
   * ITN-27 (optional): links one of the owner's confirmed or completed
   * bookings to a day, by default the day of the flight's departure or the
   * hotel's check-in. Its total then feeds the budget.
   */
  async linkBooking(
    user: UserDocument,
    id: string,
    dto: LinkBookingDto,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    const bookingModel =
      dto.bookingType === 'flight' ? 'FlightBooking' : 'HotelBooking';
    const booking =
      dto.bookingType === 'flight'
        ? await this.flightBookings
            .findOne({ _id: dto.bookingId, userId: user._id })
            .select('status segments.flightId')
            .lean()
            .exec()
        : await this.hotelBookings
            .findOne({ _id: dto.bookingId, userId: user._id })
            .select('status checkInDate')
            .lean()
            .exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.COMPLETED
    )
      throw new ConflictException(
        'Only confirmed or completed bookings can be linked.',
      );
    if (
      daysOf(itinerary).some((day) =>
        (day.linkedBookings ?? []).some((link) =>
          link.bookingId.equals(dto.bookingId),
        ),
      )
    )
      throw new ConflictException(
        'This booking is already linked to this itinerary.',
      );

    let day: DayDoc;
    if (dto.dayId) {
      day = this.findDay(itinerary, dto.dayId);
    } else {
      const date =
        'checkInDate' in booking
          ? booking.checkInDate
          : (
              await this.flights
                .findById(booking.segments[0].flightId)
                .select('departureLocalDate')
                .lean()
                .exec()
            )?.departureLocalDate;
      const index = daysOf(itinerary).findIndex(
        (_d, i) => dayDate(itinerary.startDate, i) === date,
      );
      if (index < 0)
        throw new BadRequestException(
          `No day of this itinerary falls on ${date ?? 'the booking date'}. Send dayId to choose one.`,
        );
      day = daysOf(itinerary)[index];
    }
    day.linkedBookings.push({ bookingModel, bookingId: booking._id });
    return this.save(itinerary);
  }

  async unlinkBooking(
    user: UserDocument,
    id: string,
    linkId: string,
  ): Promise<ItineraryDetailsDto> {
    const itinerary = await this.own(user, id);
    for (const day of daysOf(itinerary)) {
      const link = Types.ObjectId.isValid(linkId)
        ? day.linkedBookings.id(linkId)
        : null;
      if (link) {
        link.deleteOne();
        return this.save(itinerary);
      }
    }
    throw new NotFoundException('Linked booking not found.');
  }

  /** The owner's itinerary as a document; anyone else gets 404 (ACC-11). */
  async own(user: UserDocument, id: string): Promise<ItineraryDoc> {
    const itinerary = Types.ObjectId.isValid(id)
      ? await this.itineraries.findById(id).exec()
      : null;
    if (!itinerary) throw new NotFoundException(NOT_FOUND);
    assertOwnedBy(user, itinerary.ownerId, NOT_FOUND);
    return itinerary;
  }

  /** Finds an activity, budget entry or transport cost by its own id. */
  private async ownItem(
    user: UserDocument,
    list: 'activities' | 'budgetEntries' | 'transportCosts',
    itemId: string,
  ) {
    const label = {
      activities: 'Activity',
      budgetEntries: 'Budget entry',
      transportCosts: 'Transport cost',
    }[list];
    const itinerary = Types.ObjectId.isValid(itemId)
      ? await this.itineraries.findOne({ [`days.${list}._id`]: itemId }).exec()
      : null;
    if (!itinerary) throw new NotFoundException(`${label} not found.`);
    assertOwnedBy(user, itinerary.ownerId, `${label} not found.`);
    for (const day of daysOf(itinerary)) {
      const items = day[list] as unknown as Types.DocumentArray<
        Types.Subdocument & object
      >;
      const item = items.id(itemId);
      if (item) return { itinerary, day, item };
    }
    throw new NotFoundException(`${label} not found.`);
  }

  private findDay(itinerary: ItineraryDoc, dayId: string) {
    const day = Types.ObjectId.isValid(dayId)
      ? daysOf(itinerary).id(dayId)
      : null;
    if (!day) throw new NotFoundException('Day not found in this itinerary.');
    return day;
  }

  private async assertCountries(codes: string[]) {
    const found = await this.countries
      .find({ _id: { $in: codes } })
      .select('_id')
      .lean()
      .exec();
    const missing = codes.filter((code) => !found.some((c) => c._id === code));
    if (missing.length > 0)
      throw new BadRequestException(
        `Choose countries from the reference list; unknown: ${missing.join(', ')}.`,
      );
  }

  private async assertCity(cityId: string, countryCodes: string[]) {
    const city = await this.cities.findById(cityId).lean().exec();
    if (!city)
      throw new BadRequestException(
        'Choose a city from the reference list (GEN-12).',
      );
    if (!countryCodes.includes(city.countryCode))
      throw new BadRequestException(
        `${city.name} is not in this itinerary's countries (${countryCodes.join(', ')}).`,
      );
  }

  private async assertTransport(from: string, to: string, currency: string) {
    if (from === to)
      throw new BadRequestException(
        'Intercity transport must connect two different cities.',
      );
    const found = await this.cities
      .countDocuments({ _id: { $in: [from, to] } })
      .exec();
    if (found !== 2)
      throw new BadRequestException(
        'Choose both cities from the reference list (GEN-12).',
      );
    await this.exchangeRates.assertSupported(currency);
  }

  private async save(itinerary: ItineraryDoc): Promise<ItineraryDetailsDto> {
    try {
      await itinerary.save();
    } catch (error) {
      if (error instanceof MongooseError.VersionError)
        throw new ConflictException(
          'The itinerary changed at the same time. Reload it and try again.',
        );
      if (error instanceof MongooseError.ValidationError)
        throw new BadRequestException(
          Object.values(error.errors)
            .map((e) => e.message)
            .join(' '),
        );
      throw error;
    }
    return this.present(itinerary);
  }

  private present(itinerary: ItineraryDoc): Promise<ItineraryDetailsDto> {
    return this.presenter.details(
      itinerary.toObject() as unknown as StoredItinerary,
    );
  }
}
