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
import { HotelBookingLifecycleService } from '../src/hotel-bookings/hotel-booking-lifecycle.service';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { addDays, hotelNow } from '../src/hotels/hotel-dates';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import {
  Notification,
  NotificationType,
} from '../src/notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../src/payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../src/payments/schemas/refund.schema';
import { City } from '../src/reference-data/schemas/city.schema';
import { Review } from '../src/reviews/schemas/review.schema';
import { User, UserRole } from '../src/users/schemas/user.schema';

const TAG = 'hbook.e2e.test';
const PASSWORD = 'TestPassword2026';
const CITY = 'e2e-hbook-city';
const ZONE = 'Africa/Cairo';

describe('Hotel search and reservations (HTL-11 to HTL-21, e2e)', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let availability: Model<RoomAvailability>;
  let bookings: Model<HotelBooking>;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let notifications: Model<Notification>;
  let reviews: Model<Review>;
  let cities: Model<City>;
  let lifecycle: HotelBookingLifecycleService;
  const cookies: Record<string, string[]> = {};
  const userIds: Record<string, Types.ObjectId> = {};
  const today = hotelNow(ZONE).date;
  const day = (n: number) => addDays(today, n);
  let sequence = 0;

  const server = () => app.getHttpServer();
  const call = (method: 'get' | 'post', path: string, who?: string) => {
    const req = request(server())[method](`/api${path}`);
    return who ? req.set('Cookie', cookies[who]) : req;
  };

  async function addUser(name: string, role: UserRole) {
    const user = await users.create({
      name,
      email: `${name}@${TAG}`,
      role,
      assignedProviderId:
        role === UserRole.HOTEL_MODERATOR ? new Types.ObjectId() : undefined,
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

  /** A bookable hotel with rooms of the given occupancy and price. */
  async function makeHotel(
    roomSpecs: { occupancy: number; price: number }[],
    overrides: Record<string, unknown> = {},
  ) {
    const hotel = await hotels.create({
      name: `Booking Test Hotel ${sequence++}`,
      address: '1 Test Street',
      cityId: CITY,
      countryCode: 'EG',
      timeZone: ZONE,
      description: 'Test.',
      starClass: 4,
      policy: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [
          { daysBeforeCheckIn: 14, refundPercentage: 100 },
          { daysBeforeCheckIn: 2, refundPercentage: 50 },
        ],
      },
      ...overrides,
    });
    const created: string[] = [];
    for (const [index, spec] of roomSpecs.entries()) {
      const room = await rooms.create({
        hotelId: hotel._id,
        label: `R${index + 1}`,
        roomType: 'Double',
        bedCount: 1,
        maxOccupancy: spec.occupancy,
        nightlyPriceMinorUnits: spec.price,
      });
      await availability.create({
        roomId: room._id,
        bookableRanges: [{ fromDate: day(-30), untilDate: day(120) }],
      });
      created.push(room._id.toString());
    }
    return { id: hotel._id.toString(), rooms: created };
  }

  const reserve = (
    hotelId: string,
    roomIds: string[],
    from: number,
    until: number,
    who = 'traveler',
  ) =>
    call('post', '/hotel-bookings', who).send({
      hotelId,
      checkInDate: day(from),
      checkOutDate: day(until),
      rooms: roomIds.map((roomId) => ({ roomId, adults: 1 })),
    });

  /** Confirms a hold the way the payment service will (PAY-01, PAY-02). */
  async function confirm(id: string, withPayment = true) {
    await bookings.updateOne({ _id: id }, { policyAcceptedAt: new Date() });
    const booking = await lifecycle.confirmPaidReservation(id);
    if (withPayment)
      await payments.create({
        bookingModel: 'HotelBooking',
        bookingId: booking._id,
        stripePaymentIntentId: `pi_test_${booking.id}`,
        amountMinorUnits: booking.totalMinorUnits,
        currency: booking.currency,
        status: PaymentStatus.SUCCEEDED,
      });
    return booking;
  }

  const search = (query: string) =>
    call('get', `/hotels/search?cityId=${CITY}&${query}`);

  async function cleanUp() {
    const hotelIds = (await hotels.find({ cityId: CITY })).map((h) => h._id);
    const roomIds = (await rooms.find({ hotelId: { $in: hotelIds } })).map(
      (r) => r._id,
    );
    const bookingIds = (
      await bookings.find({ hotelId: { $in: hotelIds } })
    ).map((b) => b._id);
    const paymentIds = (
      await payments.find({ bookingId: { $in: bookingIds } })
    ).map((p) => p._id);
    await refunds.deleteMany({ paymentId: { $in: paymentIds } });
    await payments.deleteMany({ _id: { $in: paymentIds } });
    await notifications.deleteMany({ subjectId: { $in: bookingIds } });
    await reviews.deleteMany({ hotelId: { $in: hotelIds } });
    await bookings.deleteMany({ _id: { $in: bookingIds } });
    await availability.deleteMany({ roomId: { $in: roomIds } });
    await rooms.deleteMany({ _id: { $in: roomIds } });
    await hotels.deleteMany({ _id: { $in: hotelIds } });
    const ids = (
      await users.find({ email: new RegExp(`@${TAG.replace(/\./g, '\\.')}$`) })
    ).map((u) => u._id);
    await app
      .get<Model<Session>>(getModelToken(Session.name))
      .deleteMany({ userId: { $in: ids } });
    await users.deleteMany({ _id: { $in: ids } });
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
    payments = model(Payment.name);
    refunds = model(Refund.name);
    notifications = model(Notification.name);
    reviews = model(Review.name);
    cities = model(City.name);
    lifecycle = app.get(HotelBookingLifecycleService);
    await Promise.all([
      users.init(),
      rooms.init(),
      availability.init(),
      bookings.init(),
    ]);
    await cleanUp();
    await cities.create({
      _id: CITY,
      name: 'Booking Test City',
      countryCode: 'EG',
    });
    await addUser('traveler', UserRole.TRAVELER);
    await addUser('other', UserRole.TRAVELER);
    await addUser('moderator', UserRole.HOTEL_MODERATOR);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('GET /api/hotels/search (HTL-11, HTL-12)', () => {
    it('finds hotels with enough free rooms for the guests', async () => {
      const hotel = await makeHotel([
        { occupancy: 2, price: 200_000 },
        { occupancy: 4, price: 300_000 },
        { occupancy: 2, price: 150_000 },
      ]);
      const find = (query: string) =>
        search(
          `checkInDate=${day(10)}&checkOutDate=${day(13)}&${query}`,
        ).expect(200);
      const ids = (body: { items: { id: string }[] }) =>
        body.items.map((i) => i.id);

      const found = await find('guests=2');
      const item = found.body.items.find(
        (i: { id: string }) => i.id === hotel.id,
      );
      expect(item).toMatchObject({
        cityName: 'Booking Test City',
        cheapestNightlyPriceMinorUnits: 150_000,
        cheapestStayPriceMinorUnits: 450_000,
        freeRoomCount: 3,
        ratingCount: 0,
      });
      expect(found.body).toMatchObject({
        nights: 3,
        currency: 'EGP',
        pageSize: 10,
      });
      expect(ids((await find('guests=6&rooms=2')).body)).toContain(hotel.id);
      expect(ids((await find('guests=7&rooms=2')).body)).not.toContain(
        hotel.id,
      );
      expect(ids((await find('guests=5')).body)).not.toContain(hotel.id);

      // Booking the cheapest room raises the hotel's cheapest price.
      await reserve(hotel.id, [hotel.rooms[2]], 11, 12).expect(201);
      const after = (await find('guests=2')).body.items.find(
        (i: { id: string }) => i.id === hotel.id,
      );
      expect(after).toMatchObject({
        cheapestNightlyPriceMinorUnits: 200_000,
        freeRoomCount: 2,
      });
    });

    it('filters by price and rating and sorts both ways', async () => {
      const cheap = await makeHotel([{ occupancy: 2, price: 100_000 }]);
      const rated = await makeHotel([{ occupancy: 2, price: 400_000 }]);
      const stay = await bookings.create({
        userId: userIds.traveler,
        hotelId: rated.id,
        checkInDate: day(-10),
        checkOutDate: day(-8),
        timeZone: ZONE,
        rooms: [
          {
            roomId: rated.rooms[0],
            label: 'R1',
            maxOccupancy: 2,
            nightlyPriceMinorUnits: 400_000,
            adults: 1,
            childAges: [],
          },
        ],
        status: BookingStatus.COMPLETED,
        reference: 'RATED1',
        holdExpiresAt: new Date(),
        policy: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [],
        },
        policyAcceptedAt: new Date(),
        currency: 'EGP',
        totalMinorUnits: 800_000,
      });
      await reviews.create({
        bookingId: stay._id,
        hotelId: rated.id,
        authorId: userIds.traveler,
        rating: 5,
      });
      const base = `checkInDate=${day(20)}&checkOutDate=${day(21)}&guests=1`;
      const ids = async (query: string) =>
        (
          (await search(`${base}&${query}`).expect(200)).body.items as {
            id: string;
          }[]
        ).map((i) => i.id);

      expect(await ids('maxPriceMinorUnits=100000')).toContain(cheap.id);
      expect(await ids('maxPriceMinorUnits=100000')).not.toContain(rated.id);
      expect(
        await ids('minPriceMinorUnits=400000&maxPriceMinorUnits=400000'),
      ).toEqual([rated.id]);
      expect(await ids('minRating=4')).toEqual([rated.id]);
      const byRating = await ids('sortBy=rating');
      expect(byRating[0]).toBe(rated.id);
      const byPrice = await ids('sortBy=price&sortOrder=desc');
      expect(byPrice.indexOf(rated.id)).toBeLessThan(byPrice.indexOf(cheap.id));
    });

    it('leaves out inactive hotels and hotels without policies', async () => {
      const inactive = await makeHotel([{ occupancy: 2, price: 1 }], {
        isActive: false,
      });
      const noPolicy = await makeHotel([{ occupancy: 2, price: 1 }], {
        policy: undefined,
      });
      const found = await search(
        `checkInDate=${day(30)}&checkOutDate=${day(31)}&guests=1`,
      ).expect(200);
      const ids = found.body.items.map((i: { id: string }) => i.id);
      expect(ids).not.toContain(inactive.id);
      expect(ids).not.toContain(noPolicy.id);
    });

    it('rejects a search without a city or country', async () => {
      await call(
        'get',
        `/hotels/search?checkInDate=${day(5)}&checkOutDate=${day(6)}&guests=1`,
      ).expect(400);
    });

    it('rejects bad dates, prices and guest counts', async () => {
      for (const query of [
        `checkInDate=${day(5)}&checkOutDate=${day(5)}&guests=1`,
        `checkInDate=${day(-3)}&checkOutDate=${day(2)}&guests=1`,
        `checkInDate=${day(5)}&checkOutDate=${day(6)}&guests=1&minPriceMinorUnits=9&maxPriceMinorUnits=1`,
        `checkInDate=${day(5)}&checkOutDate=${day(6)}&guests=1&rooms=2`,
        `checkInDate=${day(5)}&checkOutDate=${day(6)}&guests=0`,
        `checkInDate=${day(5)}&checkOutDate=${day(6)}&guests=1&minRating=6`,
      ])
        await search(query).expect(400);
    });
  });

  describe('POST /api/hotel-bookings (HTL-16, HTL-18)', () => {
    it('holds several rooms together for 10 minutes', async () => {
      const hotel = await makeHotel([
        { occupancy: 2, price: 200_000 },
        { occupancy: 4, price: 300_000 },
      ]);
      const before = Date.now();
      const response = await call('post', '/hotel-bookings', 'traveler')
        .send({
          hotelId: hotel.id,
          checkInDate: day(10),
          checkOutDate: day(13),
          rooms: [
            { roomId: hotel.rooms[0], adults: 2 },
            { roomId: hotel.rooms[1], adults: 1, childAges: [0, 7, 17] },
          ],
        })
        .expect(201);

      expect(response.body).toMatchObject({
        status: 'pending_payment',
        nights: 3,
        guests: 6,
        totalMinorUnits: 3 * (200_000 + 300_000),
        currency: 'EGP',
        checkInTime: '14:00',
        checkOutTime: '12:00',
      });
      expect(response.body.reference).toBeUndefined();
      expect(response.body.rooms[1]).toMatchObject({
        childAges: [0, 7, 17],
        stayPriceMinorUnits: 900_000,
      });
      const holdMs = new Date(response.body.holdExpiresAt).getTime() - before;
      expect(holdMs).toBeGreaterThan(9.5 * 60_000);
      expect(holdMs).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    });

    it('holds nothing if any room is taken', async () => {
      const hotel = await makeHotel([
        { occupancy: 2, price: 1_000 },
        { occupancy: 2, price: 1_000 },
      ]);
      await reserve(hotel.id, [hotel.rooms[0]], 10, 12).expect(201);
      const refused = await reserve(
        hotel.id,
        [hotel.rooms[0], hotel.rooms[1]],
        11,
        13,
        'other',
      ).expect(409);
      expect(refused.body.message).toMatch(/room R1\. Nothing was held/);
      // The second room was not held, and a stay may start when another ends.
      await reserve(hotel.id, [hotel.rooms[1]], 11, 13, 'other').expect(201);
      await reserve(hotel.id, [hotel.rooms[0]], 12, 14, 'other').expect(201);
    });

    it('never gives the same room twice under simultaneous requests', async () => {
      const hotel = await makeHotel([{ occupancy: 2, price: 1_000 }]);
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          reserve(
            hotel.id,
            [hotel.rooms[0]],
            40 + (i % 2),
            43,
            i % 2 ? 'other' : 'traveler',
          ),
        ),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(
        await bookings.countDocuments({ 'rooms.roomId': hotel.rooms[0] }),
      ).toBe(1);
    });

    it('rejects invalid reservations', async () => {
      const hotel = await makeHotel([
        { occupancy: 2, price: 1_000 },
        { occupancy: 2, price: 1_000 },
      ]);
      const other = await makeHotel([{ occupancy: 2, price: 1_000 }]);
      const send = (body: Record<string, unknown>) =>
        call('post', '/hotel-bookings', 'traveler').send({
          hotelId: hotel.id,
          checkInDate: day(5),
          checkOutDate: day(7),
          rooms: [{ roomId: hotel.rooms[0], adults: 1 }],
          ...body,
        });

      await send({
        rooms: [{ roomId: hotel.rooms[0], adults: 0, childAges: [5] }],
      }).expect(400);
      await send({
        rooms: [
          { roomId: hotel.rooms[0], adults: 1 },
          { roomId: hotel.rooms[0], adults: 1 },
        ],
      }).expect(400);
      await send({
        rooms: [{ roomId: hotel.rooms[0], adults: 2, childAges: [3] }],
      }).expect(400);
      await send({
        rooms: [
          { roomId: hotel.rooms[0], adults: 1 },
          { roomId: hotel.rooms[1], adults: 0 },
        ],
      }).expect(400);
      await send({
        rooms: [{ roomId: hotel.rooms[0], adults: 1, childAges: [18] }],
      }).expect(400);
      await send({ checkInDate: day(-1) }).expect(400);
      await send({ checkOutDate: day(5) }).expect(400);
      await send({ checkInDate: day(110), checkOutDate: day(125) }).expect(409);
      await send({ rooms: [{ roomId: other.rooms[0], adults: 1 }] }).expect(
        404,
      );
      await send({ hotelId: new Types.ObjectId().toString() }).expect(404);
      await hotels.updateOne({ _id: hotel.id }, { isActive: false });
      await send({}).expect(409);
    });

    it('is only for signed-in travelers', async () => {
      const hotel = await makeHotel([{ occupancy: 2, price: 1_000 }]);
      await call('post', '/hotel-bookings').send({}).expect(401);
      await reserve(hotel.id, [hotel.rooms[0]], 5, 6, 'moderator').expect(403);
      await call('get', '/hotel-bookings', 'moderator').expect(403);
    });
  });

  describe('lifecycle, my reservations and cancellation (HTL-17, HTL-20, HTL-21)', () => {
    it('expires unpaid holds and frees the rooms', async () => {
      const hotel = await makeHotel([{ occupancy: 2, price: 1_000 }]);
      const hold = await reserve(hotel.id, [hotel.rooms[0]], 50, 52).expect(
        201,
      );
      await bookings.updateOne(
        { _id: hold.body.id },
        { holdExpiresAt: new Date(Date.now() - 1000) },
      );

      const cancelled = await call(
        'get',
        '/hotel-bookings?group=cancelled',
        'traveler',
      ).expect(200);
      expect(
        cancelled.body.items.find((i: { id: string }) => i.id === hold.body.id)
          .status,
      ).toBe('expired');
      await reserve(hotel.id, [hotel.rooms[0]], 50, 52, 'other').expect(201);
      await expect(
        lifecycle.confirmPaidReservation(hold.body.id),
      ).rejects.toThrow(/waiting for payment/);
    });

    it('confirms a paid hold with a reference and a notification', async () => {
      const hotel = await makeHotel([{ occupancy: 2, price: 1_000 }]);
      const hold = await reserve(hotel.id, [hotel.rooms[0]], 60, 62).expect(
        201,
      );
      await expect(
        lifecycle.confirmPaidReservation(hold.body.id),
      ).rejects.toThrow(/policies must be accepted/);
      const booking = await confirm(hold.body.id);

      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(booking.reference).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      await expect(
        notifications.countDocuments({
          subjectId: booking._id,
          type: NotificationType.BOOKING_CONFIRMED,
        }),
      ).resolves.toBe(1);

      const upcoming = await call(
        'get',
        '/hotel-bookings?group=upcoming',
        'traveler',
      ).expect(200);
      expect(
        upcoming.body.items.find((i: { id: string }) => i.id === hold.body.id),
      ).toMatchObject({
        reference: booking.reference,
        hotel: { cityName: 'Booking Test City' },
      });
      const details = await call(
        'get',
        `/hotel-bookings/${hold.body.id}`,
        'traveler',
      ).expect(200);
      expect(details.body.cancellation).toMatchObject({
        allowed: true,
        refundPercentage: 100,
        refundMinorUnits: 2_000,
      });
      await call('get', `/hotel-bookings/${hold.body.id}`, 'other').expect(404);
      await call('get', '/hotel-bookings/not-an-id', 'traveler').expect(404);
      await call('get', '/hotel-bookings?group=soon', 'traveler').expect(400);
    });

    it('cancels before check-in with the hotel refund tier and frees the rooms', async () => {
      const hotel = await makeHotel([
        { occupancy: 2, price: 100_000 },
        { occupancy: 2, price: 100_000 },
      ]);
      const hold = await reserve(hotel.id, hotel.rooms, 5, 7).expect(201);
      await call('post', `/hotel-bookings/${hold.body.id}/cancel`, 'traveler')
        .send({ confirm: true })
        .expect(409);
      const booking = await confirm(hold.body.id);

      await call('post', `/hotel-bookings/${hold.body.id}/cancel`, 'traveler')
        .send({ confirm: false })
        .expect(400);
      await call('post', `/hotel-bookings/${hold.body.id}/cancel`, 'other')
        .send({ confirm: true })
        .expect(404);
      const response = await call(
        'post',
        `/hotel-bookings/${hold.body.id}/cancel`,
        'traveler',
      )
        .send({ confirm: true })
        .expect(200);
      // 5 days before check-in: the 2-day tier (50%) of the full total.
      expect(response.body).toMatchObject({
        status: 'cancelled',
        refundPercentage: 50,
        refundMinorUnits: 200_000,
        currency: 'EGP',
        refundStatus: 'pending',
      });
      const payment = await payments.findOne({ bookingId: booking._id });
      await expect(
        refunds.findOne({ paymentId: payment!._id }),
      ).resolves.toMatchObject({
        amountMinorUnits: 200_000,
        status: RefundStatus.PENDING,
      });
      await expect(
        notifications.countDocuments({
          subjectId: booking._id,
          type: NotificationType.BOOKING_CANCELLED,
        }),
      ).resolves.toBe(1);
      await reserve(hotel.id, hotel.rooms, 5, 7, 'other').expect(201);
      await call('post', `/hotel-bookings/${hold.body.id}/cancel`, 'traveler')
        .send({ confirm: true })
        .expect(409);
    });

    it('refuses cancellation from the check-in date and shows finished stays as past', async () => {
      const hotel = await makeHotel([{ occupancy: 2, price: 1_000 }]);
      const hold = await reserve(hotel.id, [hotel.rooms[0]], 0, 2).expect(201);
      await confirm(hold.body.id);
      await call('post', `/hotel-bookings/${hold.body.id}/cancel`, 'traveler')
        .send({ confirm: true })
        .expect(409);

      // The stay ends: it becomes completed and moves to "past".
      await bookings.updateOne(
        { _id: hold.body.id },
        { checkInDate: day(-3), checkOutDate: day(-1) },
      );
      const past = await call(
        'get',
        '/hotel-bookings?group=past',
        'traveler',
      ).expect(200);
      expect(
        past.body.items.find((i: { id: string }) => i.id === hold.body.id)
          .status,
      ).toBe('completed');
    });
  });
});
