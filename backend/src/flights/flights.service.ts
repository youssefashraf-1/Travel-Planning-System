import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../airports/schemas/airport.schema';
import { assertManagesProvider, ProviderType } from '../auth/access';
import { UserDocument } from '../users/schemas/user.schema';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { effectiveFlightStatus } from './flight-status.service';
import { airportLocalDateTime, airportLocalToUtc } from './local-date-time';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}

  async create(user: UserDocument, dto: CreateFlightDto, now = new Date()) {
    if (!user.assignedProviderId)
      throw new ForbiddenException('No airline is assigned to this moderator.');
    assertManagesProvider(user, ProviderType.AIRLINE, user.assignedProviderId);
    const airline = await this.airlines
      .findById(user.assignedProviderId)
      .exec();
    if (!airline) throw new NotFoundException('Airline not found.');
    if (!airline.isActive)
      throw new ConflictException('This airline is inactive.');
    if (
      dto.departureAirportId.toLowerCase() ===
      dto.arrivalAirportId.toLowerCase()
    )
      throw new BadRequestException(
        'Arrival and departure airports must differ.',
      );
    const [departure, arrival] = await Promise.all([
      this.airports.findById(dto.departureAirportId).exec(),
      this.airports.findById(dto.arrivalAirportId).exec(),
    ]);
    if (!departure || !arrival)
      throw new BadRequestException(
        'Select both airports from the predefined airport list.',
      );
    const departureAt = airportLocalToUtc(
      dto.departureLocalDateTime,
      departure.timeZone,
    );
    const arrivalAt = airportLocalToUtc(
      dto.arrivalLocalDateTime,
      arrival.timeZone,
    );
    if (departureAt <= now)
      throw new BadRequestException('Departure must be in the future.');
    if (arrivalAt <= departureAt)
      throw new BadRequestException(
        'Arrival must be after departure, compared in UTC.',
      );
    try {
      const flight = await this.flights.create({
        airlineId: airline._id,
        flightNumber: dto.flightNumber,
        departureAirportId: departure._id,
        arrivalAirportId: arrival._id,
        departureAt,
        arrivalAt,
        departureLocalDate: dto.departureLocalDateTime.slice(0, 10),
        status: FlightStatus.SCHEDULED,
      });
      return Object.assign(flight.toObject(), {
        departureLocalDateTime: airportLocalDateTime(
          departureAt,
          departure.timeZone,
        ),
        arrivalLocalDateTime: airportLocalDateTime(arrivalAt, arrival.timeZone),
        departureTimeZone: departure.timeZone,
        arrivalTimeZone: arrival.timeZone,
      });
    } catch (error) {
      this.rethrowDuplicate(
        error,
        'This flight number already exists for your airline on this local departure date.',
      );
    }
  }

  async createCabin(
    user: UserDocument,
    flightId: string,
    dto: CreateCabinDto,
    now = new Date(),
  ) {
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found.');
    assertManagesProvider(user, ProviderType.AIRLINE, flight.airlineId);
    if (effectiveFlightStatus(flight, now) !== FlightStatus.SCHEDULED) {
      throw new ConflictException(
        'Only a scheduled future flight can have cabins added.',
      );
    }
    try {
      const cabin = await this.cabins.create({
        flightId: flight._id,
        cabinClass: dto.cabinClass,
        totalSeats: dto.totalSeats,
        priceMinorUnits: dto.priceMinorUnits,
        freeBagCount: dto.freeBagCount,
        maxBagWeightKg: dto.maxBagWeightKg,
        heldSeats: 0,
        bookedSeats: 0,
      });
      return Object.assign(cabin.toObject(), {
        seatsRemaining: cabin.totalSeats - cabin.heldSeats - cabin.bookedSeats,
      });
    } catch (error) {
      this.rethrowDuplicate(
        error,
        'This cabin class already exists for this flight.',
      );
    }
  }

  private rethrowDuplicate(error: unknown, message: string): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    )
      throw new ConflictException(message);
    throw error;
  }
}
