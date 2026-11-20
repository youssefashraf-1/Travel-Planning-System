import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { Session } from '../src/auth/schemas/session.schema';
import { BookingStatus } from '../src/common/booking-status';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { addDays, hotelNow } from '../src/hotels/hotel-dates';
import { HotelStayStatusService } from '../src/hotels/hotel-stay-status.service';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { City } from '../src/reference-data/schemas/city.schema';
import { Review } from '../src/reviews/schemas/review.schema';
import { User, UserRole, UserStatus } from '../src/users/schemas/user.schema';

const TAG = 'hotels.e2e.test';
const PASSWORD = 'TestPassword2026';
const CITY = 'e2e-hotel-city';
const ZONE = 'Africa/Cairo';
const PRICE = 250_000;

describe('Hotel management and reviews (HTL-01 to HTL-10, HTL-15, HTL-22 to HTL-24, e2e)', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let availability: Model<RoomAvailability>;
  let bookings: Model<HotelBooking>;
  let reviews: Model<Review>;
  let cities: Model<City>;
  const cookies: Record<string, string[]> = {};
  const userIds: Record<string, Types.ObjectId> = {};
  let hotelId: string;
  let otherHotelId: string;
  const today = hotelNow(ZONE).date;
  const day = (n: number) => addDays(today, n);

  const server = () => app.getHttpServer();
  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    who?: string,
  ) => {
    const req = request(server())[method](`/api${path}`);
    if (method === 'delete') req.send({ confirm: true });
    return who ? req.set('Cookie', cookies[who]) : req;
  };

  async function addUser(
    name: string,
    role: UserRole,
    provider?: Types.ObjectId,
  ) {
    const user = await users.create({
      name,
      email: `${name.toLowerCase()}@${TAG}`,
      role,
      assignedProviderId: provider,
      passwordHash: await app.get(PasswordHasherService).hash(PASSWORD),
    });
    userIds[name] = user._id;
    const login = await call('post', '/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    cookies[name] = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0]);
  }

  const hotelBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Nile View Hotel',
    address: '12 Corniche El Nil',
    cityId: CITY,
    countryCode: 'EG',
    timeZone: ZONE,
    description: 'Riverside rooms.',
    starClass: 4,
    amenities: ['Wi-Fi', 'Pool'],
    ...overrides,
  });

  async function addRoom(label: string, price = PRICE) {
    const created = await call('post', `/hotels/${hotelId}/rooms`, 'moderator')
      .send({
        label,
        roomType: 'Double',
        bedCount: 2,
        maxOccupancy: 3,
        nightlyPriceMinorUnits: price,
      })
      .expect(201);
    await call(
      'post',
      `/hotels/${hotelId}/rooms/${created.body.id}/availability`,
      'moderator',
    )
      .send({ fromDate: day(1), untilDate: day(90) })
      .expect(201);
    return created.body.id as string;
  }

  /** A reservation as Phase 8 will store it. */
  async function addBooking(
    roomId: string,
    checkIn: string,
    checkOut: string,
    status = BookingStatus.CONFIRMED,
    owner = 'traveler',
  ) {
    const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000;
    const confirmed = status !== BookingStatus.PENDING_PAYMENT;
    return bookings.create({
      userId: userIds[owner],
      hotelId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      timeZone: ZONE,
      rooms: [
        {
          roomId,
          label: 'R',
          maxOccupancy: 3,
          nightlyPriceMinorUnits: PRICE,
          adults: 2,
          childAges: [],
        },
      ],
      status,
      reference: confirmed
        ? `H${new Types.ObjectId().toString().slice(-7).toUpperCase()}`
        : undefined,
      holdExpiresAt: new Date(Date.now() + 600_000),
      policy: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [],
      },
      policyAcceptedAt: confirmed ? new Date() : undefined,
      currency: 'EGP',
      totalMinorUnits: nights * PRICE,
    });
  }

  async function cleanUp() {
    const ids = Object.values(userIds);
    const hotelIds = (await hotels.find({ name: /Hotel$/, cityId: CITY })).map(
      (h) => h._id,
    );
    const roomIds = (await rooms.find({ hotelId: { $in: hotelIds } })).map(
      (r) => r._id,
    );
    await reviews.deleteMany({ hotelId: { $in: hotelIds } });
    await bookings.deleteMany({ hotelId: { $in: hotelIds } });
    await availability.deleteMany({ roomId: { $in: roomIds } });
    await rooms.deleteMany({ _id: { $in: roomIds } });
    await hotels.deleteMany({ _id: { $in: hotelIds } });
    await app
      .get<Model<Session>>(getModelToken(Session.name))
      .deleteMany({ userId: { $in: ids } });
    await users.deleteMany({
      email: new RegExp(`@${TAG.replace(/\./g, '\\.')}$`),
    });
    await cities.deleteOne({ _id: CITY });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    users = model(User.name);
    hotels = model(Hotel.name);
    rooms = model(Room.name);
    availability = model(RoomAvailability.name);
    bookings = model(HotelBooking.name);
    reviews = model(Review.name);
    cities = model(City.name);
    await Promise.all([
      users.init(),
      rooms.init(),
      availability.init(),
      reviews.init(),
    ]);
    await cleanUp();
    await cities.create({ _id: CITY, name: 'Test Cairo', countryCode: 'EG' });

    await addUser('Admin', UserRole.ADMIN);
    await addUser('Traveler', UserRole.TRAVELER);
    await addUser('OtherTraveler', UserRole.TRAVELER);
    cookies.admin = cookies.Admin;
    cookies.traveler = cookies.Traveler;
    userIds.traveler = userIds.Traveler;
    userIds.other = userIds.OtherTraveler;
    cookies.other = cookies.OtherTraveler;

    const created = await call('post', '/hotels', 'admin')
      .send(hotelBody())
      .expect(201);
    hotelId = created.body.id;
    const other = await call('post', '/hotels', 'admin')
      .send(hotelBody({ name: 'Other Hotel' }))
      .expect(201);
    otherHotelId = other.body.id;
    await addUser(
      'Moderator',
      UserRole.HOTEL_MODERATOR,
      new Types.ObjectId(hotelId),
    );
    await addUser(
      'OtherModerator',
      UserRole.HOTEL_MODERATOR,
      new Types.ObjectId(otherHotelId),
    );
    cookies.moderator = cookies.Moderator;
    cookies.otherModerator = cookies.OtherModerator;
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('hotel profiles and policies (HTL-01, HTL-02, HTL-09, HTL-10)', () => {
    it('lets only admins create hotels, in a real city of that country', async () => {
      await call('post', '/hotels').send(hotelBody()).expect(401);
      await call('post', '/hotels', 'traveler').send(hotelBody()).expect(403);
      await call('post', '/hotels', 'moderator').send(hotelBody()).expect(403);
      const badCity = await call('post', '/hotels', 'admin')
        .send(hotelBody({ cityId: 'atlantis' }))
        .expect(400);
      expect(badCity.body.message).toMatch(/reference list/);
      await call('post', '/hotels', 'admin')
        .send(hotelBody({ countryCode: 'FR' }))
        .expect(400);
      await call('post', '/hotels', 'admin')
        .send(hotelBody({ starClass: 6, timeZone: 'Mars/Base' }))
        .expect(400);
    });

    it('shows the public profile without login', async () => {
      const response = await call('get', `/hotels/${hotelId}`).expect(200);
      expect(response.body).toMatchObject({
        name: 'Nile View Hotel',
        cityName: 'Test Cairo',
        photoUrls: [],
        photos: [],
        canBook: false,
        ratingCount: 0,
        latestReviews: [],
      });
      expect(response.body.averageRating).toBeUndefined();
      await call('get', `/hotels/${new Types.ObjectId().toString()}`).expect(
        404,
      );
    });

    it('lets only the hotel’s own moderator edit it and set policies', async () => {
      await call('patch', `/hotels/${hotelId}`, 'moderator')
        .send({ description: 'Updated by moderator.', amenities: ['Spa'] })
        .expect(200);
      for (const who of ['otherModerator', 'admin', 'traveler'])
        await call('patch', `/hotels/${hotelId}`, who)
          .send({ starClass: 5 })
          .expect(403);

      await call('put', `/hotels/${hotelId}/policies`, 'moderator')
        .send({
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [
            { daysBeforeCheckIn: 7, refundPercentage: 50 },
            { daysBeforeCheckIn: 7, refundPercentage: 80 },
          ],
        })
        .expect(400);
      await call('put', `/hotels/${hotelId}/policies`, 'moderator')
        .send({
          checkInTime: '25:00',
          checkOutTime: '12:00',
          cancellationTiers: [],
        })
        .expect(400);
      const set = await call('put', `/hotels/${hotelId}/policies`, 'moderator')
        .send({
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [
            { daysBeforeCheckIn: 2, refundPercentage: 50 },
            { daysBeforeCheckIn: 14, refundPercentage: 100 },
          ],
        })
        .expect(200);
      expect(set.body).toMatchObject({
        canBook: true,
        description: 'Updated by moderator.',
        policy: {
          checkInTime: '14:00',
          cancellationTiers: [
            { daysBeforeCheckIn: 14, refundPercentage: 100 },
            { daysBeforeCheckIn: 2, refundPercentage: 50 },
          ],
        },
      });
    });
  });

  describe('rooms and availability (HTL-03 to HTL-08, HTL-15)', () => {
    it('adds rooms with labels unique in the hotel, ignoring case', async () => {
      await addRoom('Suite A');
      await call('post', `/hotels/${hotelId}/rooms`, 'moderator')
        .send({
          label: 'suite a',
          roomType: 'Suite',
          bedCount: 1,
          maxOccupancy: 2,
          nightlyPriceMinorUnits: 1,
        })
        .expect(409);
      await call('post', `/hotels/${hotelId}/rooms`, 'moderator')
        .send({
          label: 'X',
          roomType: 'Suite',
          bedCount: 1,
          maxOccupancy: 0,
          nightlyPriceMinorUnits: 0,
        })
        .expect(400);
      await call('post', `/hotels/${otherHotelId}/rooms`, 'moderator')
        .send({
          label: 'X',
          roomType: 'Suite',
          bedCount: 1,
          maxOccupancy: 2,
          nightlyPriceMinorUnits: 1,
        })
        .expect(403);
    });

    it('keeps bookable ranges from overlapping', async () => {
      const roomId = await addRoom('101');
      const path = `/hotels/${hotelId}/rooms/${roomId}/availability`;
      await call('post', path, 'moderator')
        .send({ fromDate: day(50), untilDate: day(100) })
        .expect(409);
      await call('post', path, 'moderator')
        .send({ fromDate: day(95), untilDate: day(94) })
        .expect(400);
      const added = await call('post', path, 'moderator')
        .send({ fromDate: day(90), untilDate: day(120) })
        .expect(201);
      expect(added.body.bookableRanges).toHaveLength(2);
      await call('patch', path, 'moderator')
        .send({
          blockedRanges: [
            { fromDate: day(5), untilDate: day(9) },
            { fromDate: day(8), untilDate: day(12) },
          ],
        })
        .expect(400);
    });

    it('lists free rooms with stay prices, respecting blocks and dates', async () => {
      const roomId = await addRoom('102', 300_000);
      const available = (from: number, until: number) =>
        call(
          'get',
          `/hotels/${hotelId}/rooms/available?checkInDate=${day(from)}&checkOutDate=${day(until)}`,
        );

      const free = await available(10, 13).expect(200);
      expect(free.body).toMatchObject({ nights: 3, currency: 'EGP' });
      const room = free.body.rooms.find((r: { id: string }) => r.id === roomId);
      expect(room).toMatchObject({ nights: 3, stayPriceMinorUnits: 900_000 });

      await call(
        'patch',
        `/hotels/${hotelId}/rooms/${roomId}/availability`,
        'moderator',
      )
        .send({ blockedRanges: [{ fromDate: day(12), untilDate: day(14) }] })
        .expect(200);
      const blocked = await available(10, 13).expect(200);
      expect(
        blocked.body.rooms.some((r: { id: string }) => r.id === roomId),
      ).toBe(false);
      const outside = await available(85, 95).expect(200);
      expect(
        outside.body.rooms.some((r: { id: string }) => r.id === roomId),
      ).toBe(false);

      await available(-1, 2).expect(400);
      await available(5, 5).expect(400);
      const details = await call(
        'get',
        `/hotels/${hotelId}?checkInDate=${day(20)}&checkOutDate=${day(22)}`,
      ).expect(200);
      expect(details.body.availability.rooms.length).toBeGreaterThan(0);
      await call('get', `/hotels/${hotelId}?checkInDate=${day(20)}`).expect(
        400,
      );
    });

    it('protects reserved dates from blocks, removal, deactivation and deletion', async () => {
      const roomId = await addRoom('201');
      const booking = await addBooking(roomId, day(20), day(23));
      const hold = await addBooking(
        roomId,
        day(40),
        day(42),
        BookingStatus.PENDING_PAYMENT,
      );
      const path = `/hotels/${hotelId}/rooms/${roomId}`;

      const block = await call('patch', `${path}/availability`, 'moderator')
        .send({ blockedRanges: [{ fromDate: day(22), untilDate: day(25) }] })
        .expect(409);
      expect(block.body.message).toContain(booking.reference);
      await call('patch', `${path}/availability`, 'moderator')
        .send({ blockedRanges: [{ fromDate: day(41), untilDate: day(43) }] })
        .expect(409);
      await call('patch', `${path}/availability`, 'moderator')
        .send({ bookableRanges: [{ fromDate: day(1), untilDate: day(21) }] })
        .expect(409);
      await call('patch', path, 'moderator')
        .send({ isActive: false })
        .expect(409);
      await request(server())
        .delete(`/api${path}`)
        .set('Cookie', cookies.moderator)
        .send({ confirm: false })
        .expect(400);
      await call('delete', path, 'moderator').expect(409);

      // Neighbouring dates are fine: the stay ends on day 23.
      await call('patch', `${path}/availability`, 'moderator')
        .send({ blockedRanges: [{ fromDate: day(23), untilDate: day(25) }] })
        .expect(200);
      // Price changes never touch the reservation's stored price.
      await call('patch', path, 'moderator')
        .send({ nightlyPriceMinorUnits: 999_999 })
        .expect(200);
      expect(
        (await bookings.findById(booking._id))!.rooms[0].nightlyPriceMinorUnits,
      ).toBe(PRICE);

      const taken = await call(
        'get',
        `/hotels/${hotelId}/rooms/available?checkInDate=${day(21)}&checkOutDate=${day(22)}`,
      ).expect(200);
      expect(
        taken.body.rooms.some((r: { id: string }) => r.id === roomId),
      ).toBe(false);

      // Once the hold expires, the room can be deactivated around the
      // confirmed stay only after it is cancelled.
      await bookings.updateOne(
        { _id: hold._id },
        { holdExpiresAt: new Date(Date.now() - 1000) },
      );
      await bookings.updateOne(
        { _id: booking._id },
        { status: BookingStatus.CANCELLED },
      );
      await call('patch', path, 'moderator')
        .send({ isActive: false })
        .expect(200);
      await call('delete', path, 'moderator').expect(409);

      const fresh = await addRoom('202');
      await call(
        'delete',
        `/hotels/${hotelId}/rooms/${fresh}`,
        'moderator',
      ).expect(204);
      expect(await availability.exists({ roomId: fresh })).toBeNull();
    });

    it('shows each room’s day-by-day status to the moderator (HTL-08)', async () => {
      const roomId = await addRoom('301');
      const booking = await addBooking(roomId, day(30), day(32));
      await addBooking(roomId, day(33), day(34), BookingStatus.PENDING_PAYMENT);
      await call(
        'patch',
        `/hotels/${hotelId}/rooms/${roomId}/availability`,
        'moderator',
      )
        .send({ blockedRanges: [{ fromDate: day(35), untilDate: day(36) }] })
        .expect(200);

      const calendar = await call(
        'get',
        `/hotels/${hotelId}/availability?fromDate=${day(29)}&untilDate=${day(37)}`,
        'moderator',
      ).expect(200);
      const days = calendar.body.rooms.find(
        (r: { roomId: string }) => r.roomId === roomId,
      ).days;
      expect(days.map((d: { status: string }) => d.status)).toEqual([
        'available',
        'booked',
        'booked',
        'available',
        'held',
        'available',
        'blocked',
        'available',
      ]);
      expect(days[1].reference).toBe(booking.reference);

      await call(
        'get',
        `/hotels/${hotelId}/availability?fromDate=${day(1)}&untilDate=${day(80)}`,
        'moderator',
      ).expect(400);
      await call(
        'get',
        `/hotels/${hotelId}/availability?fromDate=${day(1)}&untilDate=${day(5)}`,
        'otherModerator',
      ).expect(403);
    });

    it('lists the hotel’s reservations with guest names (HTL-22)', async () => {
      const roomId = await addRoom('401');
      await addBooking(roomId, day(60), day(62));
      const list = await call(
        'get',
        `/hotels/${hotelId}/reservations?status=confirmed`,
        'moderator',
      ).expect(200);
      expect(list.body.pageSize).toBe(10);
      expect(list.body.items[0]).toMatchObject({
        guestName: 'Traveler',
        status: 'confirmed',
      });
      await call(
        'get',
        `/hotels/${hotelId}/reservations`,
        'otherModerator',
      ).expect(403);
      await call('get', `/hotels/${hotelId}/reservations`, 'traveler').expect(
        403,
      );
    });
  });

  describe('reviews (HTL-23, HTL-24)', () => {
    let roomId: string;
    beforeAll(async () => {
      roomId = await addRoom('501');
    });

    it('allows one review per completed stay, only by its owner', async () => {
      const past = await addBooking(roomId, day(-5), day(-2));
      const upcoming = await addBooking(roomId, day(70), day(72));
      const review = (id: unknown, who: string, body: object) =>
        call('post', `/hotel-bookings/${String(id)}/review`, who).send(body);

      await review(upcoming._id, 'traveler', { rating: 5 }).expect(409);
      await review(past._id, 'other', { rating: 5 }).expect(404);
      await review(past._id, 'traveler', { rating: 6 }).expect(400);
      await review(past._id, 'traveler', {
        rating: 4,
        body: 'x'.repeat(1001),
      }).expect(400);
      // Confirmed with check-out passed: completed on the spot.
      const created = await review(past._id, 'traveler', {
        rating: 4,
        body: 'Great view.',
      }).expect(201);
      expect(created.body).toMatchObject({
        rating: 4,
        authorName: 'Traveler',
        bookingId: String(past._id),
      });
      expect((await bookings.findById(past._id))!.status).toBe(
        BookingStatus.COMPLETED,
      );
      await review(past._id, 'traveler', { rating: 5 }).expect(409);

      const second = await addBooking(
        roomId,
        day(-10),
        day(-8),
        BookingStatus.COMPLETED,
        'other',
      );
      await review(second._id, 'other', { rating: 2 }).expect(201);

      const list = await call('get', `/hotels/${hotelId}/reviews`).expect(200);
      expect(list.body).toMatchObject({
        averageRating: 3,
        ratingCount: 2,
        totalItems: 2,
      });
      expect(list.body.items[0].rating).toBe(2);

      await call('patch', `/reviews/${created.body.id}`, 'other')
        .send({ rating: 1 })
        .expect(404);
      await call('patch', `/reviews/${created.body.id}`, 'traveler')
        .send({})
        .expect(400);
      await call('patch', `/reviews/${created.body.id}`, 'traveler')
        .send({ rating: 5, body: '' })
        .expect(200);
      const updated = await call('get', `/hotels/${hotelId}`).expect(200);
      expect(updated.body).toMatchObject({
        averageRating: 3.5,
        ratingCount: 2,
      });
      expect(updated.body.latestReviews).toHaveLength(2);

      // ACC-12: a deactivated author shows as "Deleted user".
      await users.updateOne(
        { _id: userIds.other },
        { status: UserStatus.DEACTIVATED },
      );
      const anonymised = await call('get', `/hotels/${hotelId}/reviews`).expect(
        200,
      );
      expect(anonymised.body.items[0].authorName).toBe('Deleted user');
      await users.updateOne(
        { _id: userIds.other },
        { status: UserStatus.ACTIVE },
      );

      await call('delete', `/reviews/${created.body.id}`, 'other').expect(404);
      await call('delete', `/reviews/${created.body.id}`, 'traveler').expect(
        204,
      );
      const after = await call('get', `/hotels/${hotelId}/reviews`).expect(200);
      expect(after.body).toMatchObject({ averageRating: 2, ratingCount: 1 });
    });

    it('marks finished confirmed stays as completed (GEN-11)', async () => {
      const finished = await addBooking(roomId, day(-3), day(-1));
      const ongoing = await addBooking(roomId, day(-1), day(2));
      await app.get(HotelStayStatusService).completeFinishedStays();
      expect((await bookings.findById(finished._id))!.status).toBe(
        BookingStatus.COMPLETED,
      );
      expect((await bookings.findById(ongoing._id))!.status).toBe(
        BookingStatus.CONFIRMED,
      );
    });
  });
});
