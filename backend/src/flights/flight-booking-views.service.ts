import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { assertManagesProvider, ProviderType } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { PassengerType } from '../flight-bookings/schemas/passenger.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { ModeratorBookingsQueryDto } from './dto/moderator-bookings.dto';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { Flight } from './schemas/flight.schema';

/** Quote every field and neutralize spreadsheet formulas from passenger input. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class FlightBookingViewsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,
  ) {}

  async list(user: UserDocument, id: string, query: ModeratorBookingsQueryDto) {
    const flight = await this.managedFlight(user, id);
    if (!Number.isSafeInteger((query.page - 1) * PAGE_SIZE))
      throw new BadRequestException('Page number is too large.');
    const filter = this.filter(flight._id, query.status);
    const [bookings, totalItems, cabins] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
      this.cabins
        .find({ flightId: flight._id })
        .sort({ cabinClass: 1 })
        .lean()
        .exec(),
    ]);
    return Object.assign(
      {
        items: bookings.map((booking) => this.present(booking, flight._id)),
        inventory: cabins.map((cabin) => ({
          cabinClass: cabin.cabinClass,
          totalSeats: cabin.totalSeats,
          bookedSeats: cabin.bookedSeats,
          heldSeats: cabin.heldSeats,
          seatsRemaining: Math.max(
            0,
            cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
          ),
        })),
      },
      pageInfo(query.page, totalItems),
    );
  }

  async exportCsv(
    user: UserDocument,
    id: string,
    query: ModeratorBookingsQueryDto,
  ) {
    const flight = await this.managedFlight(user, id);
    const bookings = await this.bookings
      .find(this.filter(flight._id, query.status))
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    const rows: (string | number)[][] = [
      ['reference', 'passenger', 'cabin', 'type', 'seats', 'status'],
    ];
    for (const booking of bookings) {
      const item = this.present(booking, flight._id);
      for (const passenger of item.passengers)
        rows.push([
          item.reference ?? '',
          passenger.fullName,
          item.cabinClass,
          passenger.type,
          passenger.seats,
          item.status,
        ]);
    }
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  private filter(
    flightId: Types.ObjectId,
    status?: BookingStatus,
  ): QueryFilter<FlightBooking> {
    return {
      'segments.flightId': flightId,
      status: status ?? {
        $in: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
      },
    };
  }

  private present(
    booking: FlightBooking & { _id: Types.ObjectId },
    flightId: Types.ObjectId,
  ) {
    const index = booking.segments.findIndex((segment) =>
      segment.flightId.equals(flightId),
    );
    const passengers = booking.passengers.map((passenger) => ({
      fullName: passenger.fullName,
      type: passenger.segments[index].type,
      seats: passenger.segments[index].type === PassengerType.INFANT ? 0 : 1,
    }));
    return {
      bookingId: booking._id.toString(),
      reference: booking.reference,
      status: booking.status,
      cabinClass: booking.segments[index].cabinClass,
      seats: passengers.reduce((sum, passenger) => sum + passenger.seats, 0),
      passengers,
    };
  }

  private async managedFlight(user: UserDocument, id: string) {
    const flight = Types.ObjectId.isValid(id)
      ? await this.flights.findById(id).exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found.');
    assertManagesProvider(user, ProviderType.AIRLINE, flight.airlineId);
    return flight;
  }
}
