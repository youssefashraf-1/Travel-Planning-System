import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../airports/schemas/airport.schema';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { isCalendarDate } from '../common/validation/calendar-date';
import {
  FlightSort,
  SearchFlightsDto,
  SortOrder,
} from './dto/search-flights.dto';
import { effectiveFlightStatus } from './flight-status.service';
import { airportLocalDateTime } from './local-date-time';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';

type WithId<T> = T & { _id: Types.ObjectId };
type CabinResult = Pick<
  CabinInventory,
  'cabinClass' | 'priceMinorUnits' | 'freeBagCount' | 'maxBagWeightKg'
> & { _id: Types.ObjectId; seatsRemaining: number };
interface FlightRow extends Flight {
  _id: Types.ObjectId;
  airline: WithId<Airline>;
  departureAirport: WithId<Airport>;
  arrivalAirport: WithId<Airport>;
  cabins: CabinResult[];
  durationMinutes: number;
  priceMinorUnits?: number;
}

@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}

  async search(query: SearchFlightsDto, now = new Date()) {
    this.validateSearch(query);
    const departureId = new Types.ObjectId(query.departureAirportId);
    const arrivalId = new Types.ObjectId(query.arrivalAirportId);
    const found = await this.airports
      .countDocuments({ _id: { $in: [departureId, arrivalId] } })
      .exec();
    if (found !== 2)
      throw new BadRequestException(
        'Select both airports from the predefined airport list.',
      );
    const seatsRequired = query.adults + query.children;
    const outbound = await this.searchLeg(
      departureId,
      arrivalId,
      query.departureDate,
      seatsRequired,
      query,
      now,
    );
    const result = {
      tripType: query.returnDate ? 'round_trip' : 'one_way',
      passengers: {
        adults: query.adults,
        children: query.children,
        infants: query.infants,
        seatsRequired,
      },
      outbound,
    };
    if (!query.returnDate) return result;
    return Object.assign(result, {
      return: await this.searchLeg(
        arrivalId,
        departureId,
        query.returnDate,
        seatsRequired,
        query,
        now,
      ),
    });
  }

  async details(id: string, now = new Date()) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Flight not found.');
    const rows = await this.flights
      .aggregate<FlightRow>([
        { $match: { _id: new Types.ObjectId(id) } },
        ...this.joins(),
        this.cabinLookup(),
        {
          $addFields: {
            durationMinutes: {
              $divide: [{ $subtract: ['$arrivalAt', '$departureAt'] }, 60_000],
            },
          },
        },
      ])
      .exec();
    if (!rows[0]) throw new NotFoundException('Flight not found.');
    return this.present(rows[0], now);
  }

  private validateSearch(query: SearchFlightsDto): void {
    if (
      !isCalendarDate(query.departureDate) ||
      (query.returnDate !== undefined && !isCalendarDate(query.returnDate))
    )
      throw new BadRequestException(
        'Dates must be real calendar dates in YYYY-MM-DD format.',
      );
    if (query.returnDate && query.returnDate < query.departureDate)
      throw new BadRequestException(
        'Return date cannot be earlier than departure date.',
      );
    if (
      query.departureAirportId.toLowerCase() ===
      query.arrivalAirportId.toLowerCase()
    )
      throw new BadRequestException(
        'Arrival and departure airports must differ.',
      );
    if (query.infants > query.adults)
      throw new BadRequestException(
        'There cannot be more infants than adults.',
      );
    if (!Number.isSafeInteger(query.adults + query.children))
      throw new BadRequestException('Passenger count is too large.');
    if (!Number.isSafeInteger((query.page - 1) * PAGE_SIZE))
      throw new BadRequestException('Page number is too large.');
    if (
      query.minPriceMinorUnits !== undefined &&
      query.maxPriceMinorUnits !== undefined &&
      query.minPriceMinorUnits > query.maxPriceMinorUnits
    )
      throw new BadRequestException(
        'Minimum price cannot exceed maximum price.',
      );
  }

  private async searchLeg(
    departureAirportId: Types.ObjectId,
    arrivalAirportId: Types.ObjectId,
    date: string,
    seatsRequired: number,
    query: SearchFlightsDto,
    now: Date,
  ) {
    const cabinFilter: Record<string, unknown> = {
      $expr: { $gte: ['$seatsRemaining', seatsRequired] },
    };
    if (query.cabinClass) cabinFilter.cabinClass = query.cabinClass;
    const price: Record<string, number> = {};
    if (query.minPriceMinorUnits !== undefined)
      price.$gte = query.minPriceMinorUnits;
    if (query.maxPriceMinorUnits !== undefined)
      price.$lte = query.maxPriceMinorUnits;
    if (Object.keys(price).length) cabinFilter.priceMinorUnits = price;
    const sortField = {
      [FlightSort.PRICE]: 'priceMinorUnits',
      [FlightSort.DURATION]: 'durationMinutes',
      [FlightSort.DEPARTURE]: 'departureAt',
    }[query.sortBy];
    const sort: Record<string, 1 | -1> = {
      [sortField]: query.sortOrder === SortOrder.DESC ? -1 : 1,
      _id: 1,
    };
    const [page] = await this.flights
      .aggregate<{ items: FlightRow[]; counts: { total: number }[] }>([
        {
          $match: {
            departureAirportId,
            arrivalAirportId,
            departureLocalDate: date,
            status: FlightStatus.SCHEDULED,
            departureAt: { $gt: now },
          },
        },
        ...this.joins(),
        { $match: { 'airline.isActive': true } },
        this.cabinLookup(cabinFilter),
        { $match: { 'cabins.0': { $exists: true } } },
        {
          $addFields: {
            priceMinorUnits: { $min: '$cabins.priceMinorUnits' },
            durationMinutes: {
              $divide: [{ $subtract: ['$arrivalAt', '$departureAt'] }, 60_000],
            },
          },
        },
        { $sort: sort },
        {
          $facet: {
            items: [
              { $skip: (query.page - 1) * PAGE_SIZE },
              { $limit: PAGE_SIZE },
            ],
            counts: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    return Object.assign(
      { items: page.items.map((flight) => this.present(flight, now)) },
      pageInfo(query.page, page.counts[0]?.total ?? 0),
    );
  }

  private joins(): PipelineStage[] {
    return [
      {
        $lookup: {
          from: this.airlines.collection.name,
          localField: 'airlineId',
          foreignField: '_id',
          as: 'airline',
        },
      },
      { $unwind: '$airline' },
      {
        $lookup: {
          from: this.airports.collection.name,
          localField: 'departureAirportId',
          foreignField: '_id',
          as: 'departureAirport',
        },
      },
      { $unwind: '$departureAirport' },
      {
        $lookup: {
          from: this.airports.collection.name,
          localField: 'arrivalAirportId',
          foreignField: '_id',
          as: 'arrivalAirport',
        },
      },
      { $unwind: '$arrivalAirport' },
    ];
  }

  private cabinLookup(filter?: Record<string, unknown>): PipelineStage.Lookup {
    return {
      $lookup: {
        from: this.cabins.collection.name,
        let: { flightId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$flightId', '$$flightId'] } } },
          {
            $addFields: {
              seatsRemaining: {
                $max: [
                  0,
                  {
                    $subtract: [
                      '$totalSeats',
                      { $add: ['$bookedSeats', '$heldSeats'] },
                    ],
                  },
                ],
              },
            },
          },
          ...(filter ? [{ $match: filter }] : []),
          { $sort: { priceMinorUnits: 1, _id: 1 } },
          {
            $project: {
              cabinClass: 1,
              priceMinorUnits: 1,
              freeBagCount: 1,
              maxBagWeightKg: 1,
              seatsRemaining: 1,
            },
          },
        ],
        as: 'cabins',
      },
    };
  }

  private present(row: FlightRow, now: Date) {
    const status = effectiveFlightStatus(row, now);
    return {
      _id: row._id.toString(),
      airlineId: row.airlineId.toString(),
      flightNumber: row.flightNumber,
      departureAirportId: row.departureAirportId.toString(),
      arrivalAirportId: row.arrivalAirportId.toString(),
      departureAt: row.departureAt,
      arrivalAt: row.arrivalAt,
      departureLocalDate: row.departureLocalDate,
      departureLocalDateTime: airportLocalDateTime(
        row.departureAt,
        row.departureAirport.timeZone,
      ),
      arrivalLocalDateTime: airportLocalDateTime(
        row.arrivalAt,
        row.arrivalAirport.timeZone,
      ),
      departureTimeZone: row.departureAirport.timeZone,
      arrivalTimeZone: row.arrivalAirport.timeZone,
      durationMinutes: row.durationMinutes,
      status,
      airline: {
        _id: row.airline._id.toString(),
        name: row.airline.name,
        code: row.airline.code,
        logoUrl: row.airline.logoUrl,
        isActive: row.airline.isActive,
        extraBaggagePolicy: row.airline.extraBaggagePolicy,
        cancellationTiers: row.airline.cancellationTiers,
      },
      departureAirport: this.presentAirport(row.departureAirport),
      arrivalAirport: this.presentAirport(row.arrivalAirport),
      cabins: row.cabins.map((cabin) =>
        Object.assign({}, cabin, { _id: cabin._id.toString() }),
      ),
      ...(row.priceMinorUnits === undefined
        ? {}
        : { priceMinorUnits: row.priceMinorUnits }),
      canBook:
        status === FlightStatus.SCHEDULED &&
        row.airline.isActive &&
        row.cabins.some((cabin) => cabin.seatsRemaining > 0),
    };
  }

  private presentAirport(airport: WithId<Airport>) {
    return {
      _id: airport._id.toString(),
      iataCode: airport.iataCode,
      name: airport.name,
      cityId: airport.cityId,
      countryCode: airport.countryCode,
      timeZone: airport.timeZone,
    };
  }
}
