import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/booking-status';
import { PLATFORM_CURRENCY } from '../common/currency';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  CalendarQueryDto,
  CreateRoomDto,
  DateRangeDto,
  StayQueryDto,
  UpdateAvailabilityDto,
  UpdateRoomDto,
} from './dto/hotel-requests.dto';
import {
  AvailableRoomsDto,
  HotelCalendarDto,
  ManagedRoomDto,
  RoomDayStatus,
  RoomDto,
} from './dto/hotel-responses.dto';
import {
  addDays,
  coversStay,
  datesBetween,
  DateRange,
  hasOverlaps,
  hotelNow,
  nightsBetween,
  overlaps,
} from './hotel-dates';
import { Hotel } from './schemas/hotel.schema';
import { RoomAvailability } from './schemas/room-availability.schema';
import { Room } from './schemas/room.schema';

const MAX_CALENDAR_DAYS = 62;

/** Only the fields the request actually sent; missing ones stay unchanged. */
export function definedFields<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Reservations that occupy a room: Confirmed, or Pending Payment with a
 * hold that has not expired (HTL-06, HTL-18).
 */
export function occupyingReservation(now: Date) {
  return {
    $or: [
      { status: BookingStatus.CONFIRMED },
      { status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: { $gt: now } },
    ],
  };
}

/**
 * True when the room can be booked for every night of the stay: the room
 * is active, its bookable ranges cover the stay, no blocked range touches
 * it and no occupying reservation overlaps it (HTL-04, HTL-06, HTL-15).
 */
export function roomIsFree(
  room: Pick<Room, 'isActive'>,
  availability: Pick<RoomAvailability, 'bookableRanges' | 'blockedRanges'>,
  stay: DateRange,
  hasOverlappingReservation: boolean,
): boolean {
  return (
    room.isActive &&
    !hasOverlappingReservation &&
    coversStay(availability.bookableRanges, stay) &&
    !availability.blockedRanges.some((range) => overlaps(range, stay))
  );
}

type WithId<T> = T & { _id: Types.ObjectId };

/** HTL-03 to HTL-08 and HTL-15: rooms and when they can be booked. */
@Injectable()
export class RoomsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailability>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
  ) {}

  /** The moderator's view of every room, active or not, with its ranges. */
  async listRooms(hotelId: string): Promise<ManagedRoomDto[]> {
    await this.findHotel(hotelId);
    const rooms = await this.rooms
      .find({ hotelId })
      .collation({ locale: 'en', numericOrdering: true })
      .sort({ label: 1 })
      .lean()
      .exec();
    const ranges = await this.availabilityByRoom(rooms.map((room) => room._id));
    return rooms.map((room) => ({
      ...this.presentRoom(room),
      bookableRanges: this.presentRanges(
        ranges.get(room._id.toString())?.bookableRanges,
      ),
      blockedRanges: this.presentRanges(
        ranges.get(room._id.toString())?.blockedRanges,
      ),
    }));
  }

  /** HTL-03: the room and its availability record are created together. */
  async createRoom(hotelId: string, dto: CreateRoomDto): Promise<RoomDto> {
    const hotel = await this.findHotel(hotelId);
    try {
      const room = await this.connection.transaction(async (session) => {
        const [created] = await this.rooms.create(
          [Object.assign({}, dto, { hotelId: hotel._id })],
          { session },
        );
        await this.availability.create([{ roomId: created._id }], { session });
        return created;
      });
      return this.presentRoom(room.toObject());
    } catch (error) {
      throw this.duplicateLabel(error);
    }
  }

  /**
   * HTL-05, HTL-06: edit beds, occupancy, price or type, or deactivate.
   * Reservations keep the price and occupancy they were booked with.
   */
  async updateRoom(
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
    now = new Date(),
  ): Promise<RoomDto> {
    if (Object.keys(definedFields(dto)).length === 0)
      throw new BadRequestException('Send at least one field to change.');
    try {
      const room = await this.connection.transaction(async (session) => {
        const { hotel, room } = await this.lockRoom(hotelId, roomId, session);
        if (dto.isActive === false && room.isActive) {
          const blocking = await this.occupyingReservations(
            room._id,
            {
              fromDate: hotelNow(hotel.timeZone, now).date,
              untilDate: '9999-12-31',
            },
            now,
            session,
          );
          if (blocking.length > 0)
            throw new ConflictException(
              `The room cannot be deactivated while it has reservations that have not ended (${this.describe(blocking)}).`,
            );
        }
        room.set(definedFields(dto));
        return room.save({ session });
      });
      return this.presentRoom(room.toObject());
    } catch (error) {
      throw this.duplicateLabel(error);
    }
  }

  /** HTL-06: only a room that was never reserved can be deleted. */
  async deleteRoom(hotelId: string, roomId: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      const { room } = await this.lockRoom(hotelId, roomId, session);
      if (
        await this.bookings
          .exists({ 'rooms.roomId': room._id })
          .session(session)
      )
        throw new ConflictException(
          'Only a room that was never reserved can be deleted. Deactivate it instead.',
        );
      await this.availability
        .deleteOne({ roomId: room._id }, { session })
        .exec();
      await room.deleteOne({ session });
    });
  }

  /** HTL-04: add a bookable range that does not overlap the existing ones. */
  async addBookableRange(
    hotelId: string,
    roomId: string,
    range: DateRangeDto,
  ): Promise<ManagedRoomDto> {
    this.checkRanges([range], 'The range');
    return this.connection.transaction(async (session) => {
      const { room, availability } = await this.lockRoom(
        hotelId,
        roomId,
        session,
      );
      if (
        availability.bookableRanges.some((existing) =>
          overlaps(existing, range),
        )
      )
        throw new ConflictException(
          'This range overlaps an existing bookable range. Ranges must not overlap; edit the existing range instead.',
        );
      availability.bookableRanges.push(range);
      await availability.save({ session });
      return this.presentManaged(room, availability);
    });
  }

  /**
   * HTL-05, HTL-06: replace the bookable and/or blocked ranges. Bookable
   * dates cannot be removed, and dates cannot be blocked, under a
   * confirmed or held reservation that has not ended.
   */
  async updateAvailability(
    hotelId: string,
    roomId: string,
    dto: UpdateAvailabilityDto,
    now = new Date(),
  ): Promise<ManagedRoomDto> {
    if (!dto.bookableRanges && !dto.blockedRanges)
      throw new BadRequestException(
        'Send bookableRanges and/or blockedRanges.',
      );
    if (dto.bookableRanges)
      this.checkRanges(dto.bookableRanges, 'Bookable ranges');
    if (dto.blockedRanges)
      this.checkRanges(dto.blockedRanges, 'Blocked ranges');

    return this.connection.transaction(async (session) => {
      const { hotel, room, availability } = await this.lockRoom(
        hotelId,
        roomId,
        session,
      );
      const reservations = await this.occupyingReservations(
        room._id,
        {
          fromDate: hotelNow(hotel.timeZone, now).date,
          untilDate: '9999-12-31',
        },
        now,
        session,
      );
      const stay = (booking: (typeof reservations)[number]) => ({
        fromDate: booking.checkInDate,
        untilDate: booking.checkOutDate,
      });

      if (dto.bookableRanges) {
        const uncovered = reservations.filter(
          (booking) => !coversStay(dto.bookableRanges!, stay(booking)),
        );
        if (uncovered.length > 0)
          throw new ConflictException(
            `Availability cannot be removed for dates with reservations (${this.describe(uncovered)}).`,
          );
        availability.bookableRanges = dto.bookableRanges;
      }
      if (dto.blockedRanges) {
        const clashing = reservations.filter((booking) =>
          dto.blockedRanges!.some((range) => overlaps(range, stay(booking))),
        );
        if (clashing.length > 0)
          throw new ConflictException(
            `Dates with reservations cannot be blocked (${this.describe(clashing)}).`,
          );
        availability.blockedRanges = dto.blockedRanges;
      }
      await availability.save({ session });
      return this.presentManaged(room, availability);
    });
  }

  /** HTL-08: each room's status for every day in the range. */
  async calendar(
    hotelId: string,
    query: CalendarQueryDto,
    now = new Date(),
  ): Promise<HotelCalendarDto> {
    const range = { fromDate: query.fromDate, untilDate: query.untilDate };
    this.checkRanges([range], 'The date range');
    if (nightsBetween(range.fromDate, range.untilDate) > MAX_CALENDAR_DAYS)
      throw new BadRequestException(
        `Choose at most ${MAX_CALENDAR_DAYS} days.`,
      );
    await this.findHotel(hotelId);
    const rooms = await this.rooms
      .find({ hotelId })
      .collation({ locale: 'en', numericOrdering: true })
      .sort({ label: 1 })
      .lean()
      .exec();
    const ranges = await this.availabilityByRoom(rooms.map((room) => room._id));
    const bookings = await this.bookings
      .find({
        'rooms.roomId': { $in: rooms.map((room) => room._id) },
        checkInDate: { $lt: range.untilDate },
        checkOutDate: { $gt: range.fromDate },
        $or: [
          ...occupyingReservation(now).$or,
          { status: BookingStatus.COMPLETED },
        ],
      })
      .select('rooms.roomId checkInDate checkOutDate status reference')
      .lean()
      .exec();
    const days = datesBetween(range.fromDate, range.untilDate);

    return {
      ...range,
      rooms: rooms.map((room) => {
        const availability = ranges.get(room._id.toString());
        const roomBookings = bookings.filter((booking) =>
          booking.rooms.some((reserved) => reserved.roomId.equals(room._id)),
        );
        return {
          roomId: room._id.toString(),
          label: room.label,
          days: days.map((date) => {
            const night = { fromDate: date, untilDate: addDays(date, 1) };
            const booking = roomBookings.find(
              (b) => b.checkInDate <= date && date < b.checkOutDate,
            );
            if (booking)
              return booking.status === BookingStatus.PENDING_PAYMENT
                ? { date, status: RoomDayStatus.HELD }
                : {
                    date,
                    status: RoomDayStatus.BOOKED,
                    reference: booking.reference,
                  };
            if (availability?.blockedRanges.some((r) => overlaps(r, night)))
              return { date, status: RoomDayStatus.BLOCKED };
            if (!room.isActive) return { date, status: RoomDayStatus.INACTIVE };
            if (!availability?.bookableRanges.some((r) => overlaps(r, night)))
              return { date, status: RoomDayStatus.NOT_BOOKABLE };
            return { date, status: RoomDayStatus.AVAILABLE };
          }),
        };
      }),
    };
  }

  /** HTL-15: rooms free for every night of the stay, with stay prices. */
  async availableRooms(
    hotelId: string,
    query: StayQueryDto,
    now = new Date(),
  ): Promise<AvailableRoomsDto> {
    const hotel = await this.findHotel(hotelId);
    const stay = { fromDate: query.checkInDate, untilDate: query.checkOutDate };
    this.checkStay(stay, hotel.timeZone, now);
    const nights = nightsBetween(stay.fromDate, stay.untilDate);
    const result = {
      checkInDate: stay.fromDate,
      checkOutDate: stay.untilDate,
      nights,
      currency: PLATFORM_CURRENCY,
      rooms: [] as AvailableRoomsDto['rooms'],
    };
    // A deactivated hotel's rooms cannot be booked (ACC-15).
    if (!hotel.isActive) return result;

    const rooms = await this.rooms
      .find({ hotelId: hotel._id, isActive: true })
      .lean()
      .exec();
    const ranges = await this.availabilityByRoom(rooms.map((room) => room._id));
    const taken = await this.bookings
      .find({
        'rooms.roomId': { $in: rooms.map((room) => room._id) },
        checkInDate: { $lt: stay.untilDate },
        checkOutDate: { $gt: stay.fromDate },
        ...occupyingReservation(now),
      })
      .select('rooms.roomId')
      .lean()
      .exec();
    const takenIds = new Set(
      taken.flatMap((booking) =>
        booking.rooms.map((reserved) => reserved.roomId.toString()),
      ),
    );

    result.rooms = rooms
      .filter((room) => {
        const availability = ranges.get(room._id.toString());
        return (
          !!availability &&
          roomIsFree(
            room,
            availability,
            stay,
            takenIds.has(room._id.toString()),
          )
        );
      })
      .sort(
        (a, b) =>
          a.nightlyPriceMinorUnits - b.nightlyPriceMinorUnits ||
          a.label.localeCompare(b.label, 'en', { numeric: true }),
      )
      .map((room) => ({
        ...this.presentRoom(room),
        nights,
        stayPriceMinorUnits: nights * room.nightlyPriceMinorUnits,
      }));
    return result;
  }

  /**
   * HTL-11, HTL-18: check-out after check-in, and check-in not before
   * today in the hotel's own calendar.
   */
  checkStay(stay: DateRange, timeZone: string, now: Date): void {
    if (stay.untilDate <= stay.fromDate)
      throw new BadRequestException('Check-out must be after check-in.');
    if (stay.fromDate < hotelNow(timeZone, now).date)
      throw new BadRequestException('Check-in cannot be in the past.');
  }

  /**
   * Schedule changes and reservations must contend on the same document:
   * this increments each room's availability version inside the
   * transaction, in room id order, so concurrent changes serialize. The
   * Phase 8 reservation transaction must call it for every booked room.
   */
  async lockAvailability(roomIds: Types.ObjectId[], session: ClientSession) {
    const ordered = [...roomIds].sort((a, b) =>
      a.toString().localeCompare(b.toString()),
    );
    const locked: WithId<RoomAvailability>[] = [];
    for (const roomId of ordered) {
      const availability = await this.availability
        .findOneAndUpdate(
          { roomId },
          { $inc: { __v: 1 } },
          { session, returnDocument: 'after', upsert: true },
        )
        .exec();
      locked.push(availability);
    }
    return locked;
  }

  private async lockRoom(
    hotelId: string,
    roomId: string,
    session: ClientSession,
  ) {
    const hotel = await this.findHotel(hotelId, session);
    const room = Types.ObjectId.isValid(roomId)
      ? await this.rooms
          .findOne({ _id: roomId, hotelId: hotel._id })
          .session(session)
          .exec()
      : null;
    if (!room) throw new NotFoundException('Room not found in this hotel.');
    const [locked] = await this.lockAvailability([room._id], session);
    const availability = await this.availability
      .findById(locked._id)
      .session(session)
      .exec();
    return { hotel, room, availability: availability! };
  }

  private occupyingReservations(
    roomId: Types.ObjectId,
    window: DateRange,
    now: Date,
    session: ClientSession,
  ) {
    return this.bookings
      .find({
        'rooms.roomId': roomId,
        checkInDate: { $lt: window.untilDate },
        checkOutDate: { $gt: window.fromDate },
        ...occupyingReservation(now),
      })
      .select('checkInDate checkOutDate reference status')
      .session(session)
      .lean()
      .exec();
  }

  private describe(
    bookings: {
      checkInDate: string;
      checkOutDate: string;
      reference?: string;
    }[],
  ): string {
    return bookings
      .slice(0, 3)
      .map(
        (b) =>
          `${b.reference ?? 'payment hold'} ${b.checkInDate} to ${b.checkOutDate}`,
      )
      .join('; ');
  }

  private checkRanges(ranges: DateRange[], name: string): void {
    if (ranges.some((range) => range.untilDate <= range.fromDate))
      throw new BadRequestException(
        `${name}: each untilDate must be after its fromDate.`,
      );
    if (hasOverlaps(ranges))
      throw new BadRequestException(`${name} must not overlap each other.`);
  }

  private async findHotel(hotelId: string, session?: ClientSession) {
    const hotel = Types.ObjectId.isValid(hotelId)
      ? await this.hotels
          .findById(hotelId)
          .session(session ?? null)
          .lean()
          .exec()
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found.');
    return hotel;
  }

  private async availabilityByRoom(roomIds: Types.ObjectId[]) {
    const records = await this.availability
      .find({ roomId: { $in: roomIds } })
      .lean()
      .exec();
    return new Map(records.map((record) => [record.roomId.toString(), record]));
  }

  private presentRoom(room: WithId<Room>): Pick<RoomDto, keyof RoomDto> {
    return {
      id: room._id.toString(),
      label: room.label,
      roomType: room.roomType,
      bedCount: room.bedCount,
      maxOccupancy: room.maxOccupancy,
      nightlyPriceMinorUnits: room.nightlyPriceMinorUnits,
      isActive: room.isActive,
    };
  }

  private presentRanges(ranges: DateRange[] | undefined) {
    return [...(ranges ?? [])]
      .sort((a, b) => a.fromDate.localeCompare(b.fromDate))
      .map(({ fromDate, untilDate }) => ({ fromDate, untilDate }));
  }

  private presentManaged(
    room: WithId<Room>,
    availability: RoomAvailability,
  ): ManagedRoomDto {
    return {
      ...this.presentRoom(room),
      bookableRanges: this.presentRanges(availability.bookableRanges),
      blockedRanges: this.presentRanges(availability.blockedRanges),
    };
  }

  private duplicateLabel(error: unknown): unknown {
    return (error as { code?: number }).code === 11000
      ? new ConflictException(
          'A room with this label already exists in the hotel.',
        )
      : error;
  }
}
