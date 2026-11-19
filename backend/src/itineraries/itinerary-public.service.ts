import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Airport } from '../airports/schemas/airport.schema';
import { escapeRegExp, PAGE_SIZE, pageInfo } from '../common/pagination';
import { ImageUploadsService } from '../common/uploads/image-uploads.service';
import { SearchFlightsDto } from '../flights/dto/search-flights.dto';
import { FlightSearchService } from '../flights/flight-search.service';
import { SearchHotelsQueryDto } from '../hotels/dto/hotel-search.dto';
import { addDays } from '../hotels/hotel-dates';
import { HotelSearchService } from '../hotels/hotel-search.service';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import {
  ItineraryFlightsQueryDto,
  ItineraryHotelsQueryDto,
  PublicSearchQueryDto,
} from './dto/itinerary-requests.dto';
import {
  ItineraryDetailsDto,
  PublicItineraryViewDto,
  PublicSearchResultDto,
} from './dto/itinerary-responses.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import {
  cityGroups,
  dayDate,
  ItineraryPresenter,
  StoredItinerary,
} from './itinerary-presenter';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema';

const NOT_FOUND = 'Itinerary not found.';

/**
 * ITN-20, ITN-21: public itineraries are searchable and read-only to
 * others, and registered users can clone them. Hidden itineraries (GEN-10)
 * and those of deactivated authors (ACC-12) are never shown. Also ITN-25
 * and ITN-26: hotel and flight searches from an itinerary.
 */
@Injectable()
export class ItineraryPublicService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    private readonly presenter: ItineraryPresenter,
    private readonly budget: ItineraryBudgetService,
    private readonly owned: ItinerariesService,
    private readonly uploads: ImageUploadsService,
    private readonly hotelSearch: HotelSearchService,
    private readonly flightSearch: FlightSearchService,
  ) {}

  /** ITN-21: keyword, country, city and duration filters, newest first. */
  async search(query: PublicSearchQueryDto): Promise<PublicSearchResultDto> {
    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    )
      throw new BadRequestException('minDays cannot be greater than maxDays.');

    const filter: QueryFilter<Itinerary> & { $and: object[] } = {
      ...(await this.visibleFilter()),
      $and: [],
    };
    if (query.countryCode)
      filter.$and.push({ countryCodes: query.countryCode });
    if (query.cityId) filter.$and.push({ 'days.cityId': query.cityId });
    if (query.minDays !== undefined)
      filter.$and.push({
        $expr: { $gte: [{ $size: '$days' }, query.minDays] },
      });
    if (query.maxDays !== undefined)
      filter.$and.push({
        $expr: { $lte: [{ $size: '$days' }, query.maxDays] },
      });
    if (query.keyword) {
      const pattern = new RegExp(escapeRegExp(query.keyword), 'i');
      const [countries, cities] = await Promise.all([
        this.countries
          .find({
            $or: [{ _id: query.keyword.toUpperCase() }, { name: pattern }],
          })
          .select('_id')
          .lean()
          .exec(),
        this.cities
          .find({
            $or: [{ _id: query.keyword.toLowerCase() }, { name: pattern }],
          })
          .select('_id')
          .lean()
          .exec(),
      ]);
      filter.$and.push({
        $or: [
          { title: pattern },
          { countryCodes: { $in: countries.map((c) => c._id) } },
          { 'days.cityId': { $in: cities.map((c) => c._id) } },
        ],
      });
    }
    if (filter.$and.length === 0) delete (filter as { $and?: object[] }).$and;

    const page = query.page ?? 1;
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
      items: items.map((item) =>
        Object.assign(this.presenter.summary(item, names), {
          authorName: names.user(item.ownerId),
          cityNames: [...new Set(item.days.map((d) => names.city(d.cityId)))],
        }),
      ),
    };
  }

  /** ITN-21: read-only, with author, days, activities and budget. */
  async view(id: string, currency?: string): Promise<PublicItineraryViewDto> {
    const itinerary = await this.findVisible(id);
    const details = await this.presenter.details(itinerary);
    let budget: PublicItineraryViewDto['budget'];
    try {
      budget = await this.budget.summary(itinerary, currency);
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
    }
    return Object.assign(details, {
      authorId: itinerary.ownerId.toString(),
      authorName: await this.presenter.authorName(itinerary),
      budget,
    });
  }

  /**
   * ITN-21: a private, independent copy with all days, activities and
   * budgets, crediting the original author.
   */
  async clone(user: UserDocument, id: string): Promise<ItineraryDetailsDto> {
    const source = await this.findVisible(id);
    const days = await Promise.all(
      source.days.map(async (day) => ({
        cityId: day.cityId,
        notes: day.notes,
        activities: await Promise.all(
          day.activities.map(async (activity) => ({
            name: activity.name,
            description: activity.description,
            localTime: activity.localTime,
            cost: activity.cost && {
              amountMinorUnits: activity.cost.amountMinorUnits,
              currency: activity.cost.currency,
            },
            images: await Promise.all(
              activity.images.map(async (image) => ({
                url: await this.uploads.duplicate(image.url, 'activities'),
              })),
            ),
          })),
        ),
        budgetEntries: day.budgetEntries.map((entry) => ({
          category: entry.category,
          description: entry.description,
          amountMinorUnits: entry.amountMinorUnits,
          currency: entry.currency,
        })),
        transportCosts: day.transportCosts.map((transport) => ({
          mode: transport.mode,
          fromCityId: transport.fromCityId,
          toCityId: transport.toCityId,
          amountMinorUnits: transport.amountMinorUnits,
          currency: transport.currency,
        })),
      })),
    );
    const clone = await this.itineraries.create({
      ownerId: user._id,
      title: source.title,
      countryCodes: source.countryCodes,
      startDate: source.startDate,
      visibility: ItineraryVisibility.PRIVATE,
      days,
      clonedFrom: {
        sourceItineraryId: source._id,
        // A clone of a clone still credits the first author.
        originalAuthorId: source.clonedFrom?.originalAuthorId ?? source.ownerId,
      },
    });
    return this.presenter.details(
      clone.toObject() as unknown as StoredItinerary,
    );
  }

  /**
   * ITN-25: hotels for one city group: check-in on its first day,
   * check-out the day after its last day (HTL-11).
   */
  async hotels(user: UserDocument, id: string, query: ItineraryHotelsQueryDto) {
    const itinerary = (
      await this.owned.own(user, id)
    ).toObject() as unknown as StoredItinerary;
    const names = await this.presenter.names([itinerary]);
    const groups = cityGroups(itinerary, names.city);
    const group = groups[query.group - 1];
    if (!group)
      throw new BadRequestException(
        groups.length
          ? `group must be between 1 and ${groups.length}.`
          : 'Add days to the itinerary first.',
      );
    const results = await this.hotelSearch.search(
      Object.assign(new SearchHotelsQueryDto(), {
        cityId: group.cityId,
        checkInDate: group.startDate,
        checkOutDate: addDays(group.endDate, 1),
        guests: query.guests,
        rooms: query.rooms ?? 1,
        page: query.page ?? 1,
      }),
    );
    return { group, results };
  }

  /**
   * ITN-26: flights from an origin to every airport in the first day's
   * city. Departure defaults to the start date; a round trip returns on
   * the last day's date by default (FLT-11, FLT-12).
   */
  async flights(
    user: UserDocument,
    id: string,
    query: ItineraryFlightsQueryDto,
  ) {
    const itinerary = (
      await this.owned.own(user, id)
    ).toObject() as unknown as StoredItinerary;
    if (itinerary.days.length === 0)
      throw new BadRequestException('Add days to the itinerary first.');
    const cityId = itinerary.days[0].cityId;
    const [origin, destinations, city] = await Promise.all([
      this.airports.findById(query.originAirportId).lean().exec(),
      this.airports.find({ cityId }).sort({ iataCode: 1 }).lean().exec(),
      this.cities.findById(cityId).lean().exec(),
    ]);
    if (!origin) throw new NotFoundException('Origin airport not found.');
    const departureDate = query.departureDate ?? itinerary.startDate;
    const returnDate =
      query.tripType === 'round_trip'
        ? (query.returnDate ??
          dayDate(itinerary.startDate, itinerary.days.length - 1))
        : undefined;

    const results = [];
    for (const destination of destinations) {
      if (destination._id.equals(origin._id)) continue;
      results.push({
        airport: {
          id: destination._id.toString(),
          iataCode: destination.iataCode,
          name: destination.name,
        },
        results: await this.flightSearch.search(
          Object.assign(new SearchFlightsDto(), {
            departureAirportId: origin._id.toString(),
            arrivalAirportId: destination._id.toString(),
            departureDate,
            returnDate,
            adults: query.adults ?? 1,
            children: query.children ?? 0,
            infants: query.infants ?? 0,
          }),
        ),
      });
    }
    return {
      cityId,
      cityName: city?.name ?? cityId,
      tripType: query.tripType ?? 'one_way',
      departureDate,
      returnDate,
      destinations: results,
    };
  }

  /** Public, not hidden, and the author's account is not deactivated. */
  private async visibleFilter(): Promise<QueryFilter<Itinerary>> {
    const deactivated = await this.users
      .find({ status: UserStatus.DEACTIVATED })
      .distinct('_id')
      .exec();
    return {
      visibility: ItineraryVisibility.PUBLIC,
      hiddenAt: null,
      ownerId: { $nin: deactivated as Types.ObjectId[] },
    };
  }

  private async findVisible(id: string): Promise<StoredItinerary> {
    const itinerary = Types.ObjectId.isValid(id)
      ? await this.itineraries
          .findOne({ _id: id, ...(await this.visibleFilter()) })
          .lean<StoredItinerary>()
          .exec()
      : null;
    if (!itinerary) throw new NotFoundException(NOT_FOUND);
    return itinerary;
  }
}
