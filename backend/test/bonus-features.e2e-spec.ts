import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Airline } from '../src/airlines/schemas/airline.schema';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { AccountToken } from '../src/auth/schemas/account-token.schema';
import { Session } from '../src/auth/schemas/session.schema';
import { BlogPost } from '../src/blog/schemas/blog-post.schema';
import { BookingStatus } from '../src/common/booking-status';
import { MailService, type MailMessage } from '../src/common/mail/mail.service';
import { Favourite } from '../src/favourites/schemas/favourite.schema';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { CabinClass } from '../src/flights/schemas/cabin-inventory.schema';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { addDays, hotelNow } from '../src/hotels/hotel-dates';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { Itinerary } from '../src/itineraries/schemas/itinerary.schema';
import { Payment, PaymentStatus } from '../src/payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../src/payments/schemas/refund.schema';
import { City } from '../src/reference-data/schemas/city.schema';
import { Country } from '../src/reference-data/schemas/country.schema';
import { Currency } from '../src/reference-data/schemas/currency.schema';
import { Review } from '../src/reviews/schemas/review.schema';
import { User, UserRole } from '../src/users/schemas/user.schema';

const TAG = 'bonus.e2e.test';
const PASSWORD = 'TestPassword2026';
const CITY = 'e2e-bonus-city';
const ZONE = 'Africa/Cairo';

describe('Bonus features (ACC-02, ACC-07, HTL-26, BLG-13, ITN-27, ITN-28, BON-01, BON-02, e2e)', () => {
  let app: INestApplication<App>;
  let m: Record<string, Model<any>>;
  const mail: MailMessage[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, Types.ObjectId> = {};
  const today = hotelNow(ZONE).date;
  const day = (n: number) => addDays(today, n);
  let hotelId: Types.ObjectId;
  let roomId: Types.ObjectId;
  let otherHotelId: Types.ObjectId;
  const fetchSpy = jest.spyOn(global, 'fetch');

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const req = request(app.getHttpServer())[method](`/api${path}`);
    return who ? req.set('Cookie', cookies[who]) : req;
  };
  const cookiesOf = (response: request.Response) =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0]);
  const login = async (email: string, password = PASSWORD) =>
    call('post', '/auth/login').send({ email, password });
  const tokenIn = (message: MailMessage) =>
    /token=([\w-]+)/.exec(message.text)![1];
  const lastMailTo = (email: string) =>
    mail.filter((message) => message.to === email).at(-1)!;

  async function addUser(name: string, role: UserRole, extra = {}) {
    const user = await m.users.create({
      name,
      email: `${name.toLowerCase()}@${TAG}`,
      role,
      passwordHash: await app.get(PasswordHasherService).hash(PASSWORD),
      ...extra,
    });
    ids[name] = user._id;
    cookies[name] = cookiesOf(await login(user.email));
  }

  /** A hotel reservation stored the way phase 8 stores one. */
  async function addHotelBooking(
    owner: string,
    status: BookingStatus,
    checkIn: string,
    nights = 2,
  ) {
    return m.hotelBookings.create({
      userId: ids[owner],
      hotelId,
      checkInDate: checkIn,
      checkOutDate: addDays(checkIn, nights),
      timeZone: ZONE,
      rooms: [
        {
          roomId,
          label: '1',
          maxOccupancy: 2,
          nightlyPriceMinorUnits: 100_000,
          adults: 1,
          childAges: [],
        },
      ],
      status,
      reference:
        status === BookingStatus.PENDING_PAYMENT
          ? undefined
          : `B${new Types.ObjectId().toString().slice(-7).toUpperCase()}`,
      holdExpiresAt: new Date(Date.now() + 600_000),
      policy: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [],
      },
      policyAcceptedAt:
        status === BookingStatus.PENDING_PAYMENT ? undefined : new Date(),
      currency: 'EGP',
      totalMinorUnits: nights * 100_000,
    });
  }

  async function cleanUp() {
    const userIds = (
      await m.users.find({
        email: new RegExp(`@${TAG.replace(/\./g, '\\.')}$`),
      })
    ).map((u) => u._id);
    const hotels = (await m.hotels.find({ cityId: CITY })).map((h) => h._id);
    const bookings = [
      ...(await m.hotelBookings.find({ hotelId: { $in: hotels } })),
      ...(await m.flightBookings.find({ userId: { $in: userIds } })),
    ].map((b) => b._id);
    const payments = (
      await m.payments.find({ bookingId: { $in: bookings } })
    ).map((p) => p._id);
    await m.refunds.deleteMany({ paymentId: { $in: payments } });
    await m.payments.deleteMany({ _id: { $in: payments } });
    await m.hotelBookings.deleteMany({ hotelId: { $in: hotels } });
    await m.flightBookings.deleteMany({ userId: { $in: userIds } });
    await m.reviews.deleteMany({ hotelId: { $in: hotels } });
    const rooms = (await m.rooms.find({ hotelId: { $in: hotels } })).map(
      (r) => r._id,
    );
    await m.availability.deleteMany({ roomId: { $in: rooms } });
    await m.rooms.deleteMany({ _id: { $in: rooms } });
    await m.hotels.deleteMany({ _id: { $in: hotels } });
    await m.airlines.deleteMany({ code: { $in: ['BNA', 'BNB'] } });
    await m.posts.deleteMany({ authorId: { $in: userIds } });
    await m.itineraries.deleteMany({ ownerId: { $in: userIds } });
    await m.favourites.deleteMany({ userId: { $in: userIds } });
    await m.tokens.deleteMany({ userId: { $in: userIds } });
    await app
      .get<Model<Session>>(getModelToken(Session.name))
      .deleteMany({ userId: { $in: userIds } });
    await m.users.deleteMany({ _id: { $in: userIds } });
    await m.cities.deleteMany({ _id: CITY });
    await m.countries.deleteMany({ _id: 'QB' });
  }

  beforeAll(async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            date: '2026-11-20T00:00:00.000Z',
            rates: { EGP: 1, USD: 0.02 },
          }),
        ),
    );
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        send: async (message: MailMessage) => {
          mail.push(message);
        },
        apiUrl: () => 'http://api.test',
        frontendUrl: () => 'http://app.test',
      })
      .compile();
    app = fixture.createNestApplication();
    configureApp(app);
    await app.init();
    const model = (name: string) => app.get<Model<any>>(getModelToken(name));
    m = {
      users: model(User.name),
      tokens: model(AccountToken.name),
      hotels: model(Hotel.name),
      rooms: model(Room.name),
      availability: model(RoomAvailability.name),
      hotelBookings: model(HotelBooking.name),
      flightBookings: model(FlightBooking.name),
      airlines: model(Airline.name),
      payments: model(Payment.name),
      refunds: model(Refund.name),
      reviews: model(Review.name),
      posts: model(BlogPost.name),
      itineraries: model(Itinerary.name),
      favourites: model(Favourite.name),
      cities: model(City.name),
      countries: model(Country.name),
      currencies: model(Currency.name),
      rates: model('ExchangeRate'),
    };
    await Promise.all(Object.values(m).map((x) => x.init()));
    await cleanUp();
    await m.rates.deleteMany({});
    for (const code of ['EGP', 'USD'])
      await m.currencies.updateOne(
        { _id: code },
        { $set: { _id: code } },
        { upsert: true },
      );
    await m.countries.create({
      _id: 'QB',
      name: 'Bonusland',
      currencyCode: 'EGP',
    });
    await m.cities.create({ _id: CITY, name: 'Bonus City', countryCode: 'QB' });

    const [hotel, other] = await m.hotels.create([
      {
        name: 'Bonus Hotel',
        address: 'x',
        cityId: CITY,
        countryCode: 'QB',
        timeZone: ZONE,
        description: 'x',
        starClass: 4,
        policy: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [],
        },
      },
      {
        name: 'Other Bonus Hotel',
        address: 'x',
        cityId: CITY,
        countryCode: 'QB',
        timeZone: ZONE,
        description: 'x',
        starClass: 3,
        policy: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [],
        },
      },
    ]);
    hotelId = hotel._id;
    otherHotelId = other._id;
    const room = await m.rooms.create({
      hotelId,
      label: '1',
      roomType: 'Double',
      bedCount: 1,
      maxOccupancy: 2,
      nightlyPriceMinorUnits: 100_000,
    });
    roomId = room._id;
    await m.availability.create({
      roomId,
      bookableRanges: [{ fromDate: day(-60), untilDate: day(120) }],
    });

    await addUser('Traveler', UserRole.TRAVELER);
    await addUser('Reader', UserRole.TRAVELER);
    await addUser('Moderator', UserRole.HOTEL_MODERATOR, {
      assignedProviderId: hotelId,
    });
    await addUser('OtherModerator', UserRole.HOTEL_MODERATOR, {
      assignedProviderId: otherHotelId,
    });
    await addUser('Admin', UserRole.ADMIN);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    fetchSpy.mockRestore();
  });

  describe('email verification (ACC-02)', () => {
    it('emails a link after sign-up and blocks booking until it is used', async () => {
      const email = `newcomer@${TAG}`;
      const registered = await call('post', '/auth/register')
        .send({
          name: 'Newcomer',
          email,
          password: PASSWORD,
          acceptTermsAndPrivacy: true,
        })
        .expect(201);
      expect(registered.body.emailVerified).toBe(false);
      const message = lastMailTo(email);
      expect(message.text).toContain(
        'http://api.test/api/auth/verify-email?token=',
      );
      expect(JSON.stringify(registered.body)).not.toContain(tokenIn(message));

      cookies.Newcomer = cookiesOf(await login(email));
      const book = () =>
        call('post', '/hotel-bookings', 'Newcomer').send({
          hotelId: hotelId.toString(),
          checkInDate: day(30),
          checkOutDate: day(31),
          rooms: [{ roomId: roomId.toString(), adults: 1 }],
        });
      const blocked = await book().expect(403);
      expect(blocked.body.message).toMatch(/Verify your email/);

      // A new link replaces the first one.
      await call('post', '/auth/resend-verification', 'Newcomer').expect(204);
      const first = tokenIn(message);
      const second = tokenIn(lastMailTo(email));
      expect(second).not.toBe(first);
      await call('get', `/auth/verify-email?token=${first}`).expect(400);
      await call('get', '/auth/verify-email?token=nonsense').expect(400);
      await call('get', `/auth/verify-email?token=${second}`).expect(200);
      await call('get', `/auth/verify-email?token=${second}`).expect(400);

      const me = await call('get', '/auth/me', 'Newcomer').expect(200);
      expect(me.body.emailVerified).toBe(true);
      await book().expect(201);
      await call('post', '/auth/resend-verification', 'Newcomer').expect(409);
    });
  });

  describe('password reset (ACC-07)', () => {
    it('answers the same for any email and resets with the newest, unused link', async () => {
      const email = `traveler@${TAG}`;
      const before = mail.length;
      const unknown = await call('post', '/auth/forgot-password')
        .send({ email: `nobody@${TAG}` })
        .expect(202);
      const known = await call('post', '/auth/forgot-password')
        .send({ email })
        .expect(202);
      expect(unknown.body).toEqual(known.body);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mail.slice(before).map((message) => message.to)).toEqual([email]);
      const first = tokenIn(lastMailTo(email));
      expect(lastMailTo(email).text).toContain(
        'http://app.test/reset-password?token=',
      );

      await call('post', '/auth/forgot-password').send({ email }).expect(202);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = tokenIn(lastMailTo(email));
      await call('post', '/auth/reset-password')
        .send({ token: first, newPassword: 'NewPassword2027' })
        .expect(400);
      await call('post', '/auth/reset-password')
        .send({ token: second, newPassword: 'short' })
        .expect(400);
      await call('post', '/auth/reset-password')
        .send({ token: second, newPassword: 'NewPassword2027' })
        .expect(204);
      await call('post', '/auth/reset-password')
        .send({ token: second, newPassword: 'Another2028' })
        .expect(400);

      await call('get', '/auth/me', 'Traveler').expect(401);
      expect((await login(email)).status).toBe(401);
      cookies.Traveler = cookiesOf(await login(email, 'NewPassword2027'));
      expect(cookies.Traveler.length).toBeGreaterThan(0);

      // Links expire after 30 minutes.
      await call('post', '/auth/forgot-password').send({ email }).expect(202);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const third = tokenIn(lastMailTo(email));
      await m.tokens.updateMany(
        { userId: ids.Traveler, usedAt: { $exists: false } },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      await call('post', '/auth/reset-password')
        .send({ token: third, newPassword: 'Later2029x' })
        .expect(400);
      await call('post', '/auth/forgot-password')
        .send({ email: 'not-an-email' })
        .expect(400);
    });
  });

  describe('review replies (HTL-26)', () => {
    it("lets only the hotel's moderator reply, shown under the review", async () => {
      const stay = await addHotelBooking(
        'Reader',
        BookingStatus.COMPLETED,
        day(-10),
      );
      const review = await m.reviews.create({
        bookingId: stay._id,
        hotelId,
        authorId: ids.Reader,
        rating: 4,
        body: 'Nice',
      });
      const path = `/reviews/${review._id.toString()}/reply`;

      await call('post', path, 'OtherModerator')
        .send({ body: 'Thanks' })
        .expect(403);
      await call('post', path, 'Reader').send({ body: 'Thanks' }).expect(403);
      await call('post', path).send({ body: 'Thanks' }).expect(401);
      await call('post', path, 'Moderator').send({ body: '' }).expect(400);
      await call('post', path, 'Moderator')
        .send({ body: 'Thanks for staying!' })
        .expect(200);
      const updated = await call('post', path, 'Moderator')
        .send({ body: 'Thank you, come back soon!' })
        .expect(200);
      expect(updated.body.reply.body).toBe('Thank you, come back soon!');

      const list = await call(
        'get',
        `/hotels/${hotelId.toString()}/reviews`,
      ).expect(200);
      expect(list.body.items[0].reply).toMatchObject({
        body: 'Thank you, come back soon!',
      });
      await m.reviews.updateOne({ _id: review._id }, { hiddenAt: new Date() });
      await call('post', path, 'Moderator').send({ body: 'Again' }).expect(404);
    });
  });

  describe('itineraries on posts, PDF export and favourites (BLG-13, ITN-28, BON-02)', () => {
    let itineraryId: string;
    let postId: string;

    beforeAll(async () => {
      const created = await call('post', '/itineraries', 'Traveler')
        .send({ title: 'Bonus Trip', countryCodes: ['QB'], startDate: day(40) })
        .expect(201);
      itineraryId = created.body.id;
      await call('post', `/itineraries/${itineraryId}/days`, 'Traveler')
        .send({ cityId: CITY })
        .expect(201);
      const post = await call('post', '/posts', 'Traveler')
        .send({ title: 'My trip', body: 'Read about it.', status: 'published' })
        .expect(201);
      postId = post.body.id;
    });

    it('attaches only your own public itinerary to a post (BLG-13)', async () => {
      const attach = (body: object, who = 'Traveler') =>
        call('patch', `/posts/${postId}/itinerary`, who).send(body);
      await attach({ itineraryId }).expect(400);
      await call('patch', `/itineraries/${itineraryId}`, 'Traveler')
        .send({ visibility: 'public' })
        .expect(200);
      const attached = await attach({ itineraryId }).expect(200);
      expect(attached.body.itinerary).toMatchObject({
        id: itineraryId,
        title: 'Bonus Trip',
        dayCount: 1,
      });
      await attach({ itineraryId }, 'Reader').expect(404);

      const view = await call('get', `/posts/${postId}`).expect(200);
      expect(view.body.itinerary.id).toBe(itineraryId);
      await call('patch', `/itineraries/${itineraryId}`, 'Traveler')
        .send({ visibility: 'private' })
        .expect(200);
      expect(
        (await call('get', `/posts/${postId}`).expect(200)).body.itinerary,
      ).toBeUndefined();
      await call('patch', `/itineraries/${itineraryId}`, 'Traveler')
        .send({ visibility: 'public' })
        .expect(200);

      const detached = await attach({ itineraryId: null }).expect(200);
      expect(detached.body.itinerary).toBeUndefined();
      await attach({ itineraryId: 'x' }).expect(400);
    });

    it('exports the itinerary as a PDF for its owner (ITN-28)', async () => {
      const pdf = await call(
        'get',
        `/itineraries/${itineraryId}/pdf?currency=USD`,
        'Traveler',
      )
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      const text = (pdf.body as Buffer).toString('latin1');
      expect(text.startsWith('%PDF')).toBe(true);
      expect(text).toContain('Bonus Trip');
      expect(text).toContain('Bonus City');
      await call('get', `/itineraries/${itineraryId}/pdf`, 'Reader').expect(
        404,
      );
    });

    it('saves hotels and public itineraries to favourites (BON-02)', async () => {
      const save = (body: object, who = 'Reader') =>
        call('post', '/favourites', who).send(body);
      await save({ type: 'hotel', id: hotelId.toString() }).expect(201);
      await save({ type: 'hotel', id: hotelId.toString() }).expect(201);
      await save({ type: 'itinerary', id: itineraryId }).expect(201);
      await save({ type: 'itinerary', id: itineraryId }, 'Traveler').expect(
        400,
      );
      await save({ type: 'hotel', id: new Types.ObjectId().toString() }).expect(
        404,
      );
      await save({ type: 'flight', id: hotelId.toString() }).expect(400);

      const list = await call('get', '/favourites', 'Reader').expect(200);
      expect(list.body.totalItems).toBe(2);
      expect(list.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'hotel',
            title: 'Bonus Hotel',
            available: true,
          }),
          expect.objectContaining({
            type: 'itinerary',
            title: 'Bonus Trip',
            available: true,
          }),
        ]),
      );
      await call('patch', `/itineraries/${itineraryId}`, 'Traveler')
        .send({ visibility: 'private' })
        .expect(200);
      const onlyItineraries = await call(
        'get',
        '/favourites?type=itinerary',
        'Reader',
      ).expect(200);
      expect(onlyItineraries.body.items).toEqual([
        expect.objectContaining({ available: false }),
      ]);

      await call(
        'delete',
        `/favourites/hotel/${hotelId.toString()}`,
        'Reader',
      ).expect(204);
      await call(
        'delete',
        `/favourites/hotel/${hotelId.toString()}`,
        'Reader',
      ).expect(404);
      await call('get', '/favourites', 'Moderator').expect(403);
    });
  });

  describe('bookings in itineraries (ITN-27)', () => {
    it('links confirmed bookings to their day and counts them in the budget', async () => {
      const created = await call('post', '/itineraries', 'Reader')
        .send({
          title: 'Linked Trip',
          countryCodes: ['QB'],
          startDate: day(50),
        })
        .expect(201);
      const id = created.body.id as string;
      for (let i = 0; i < 3; i++)
        await call('post', `/itineraries/${id}/days`, 'Reader')
          .send({ cityId: CITY })
          .expect(201);

      const confirmed = await addHotelBooking(
        'Reader',
        BookingStatus.CONFIRMED,
        day(51),
      );
      const pending = await addHotelBooking(
        'Reader',
        BookingStatus.PENDING_PAYMENT,
        day(70),
      );
      const someoneElses = await addHotelBooking(
        'Traveler',
        BookingStatus.CONFIRMED,
        day(60),
      );
      const offDates = await addHotelBooking(
        'Reader',
        BookingStatus.CONFIRMED,
        day(80),
      );
      const link = (bookingId: unknown, extra = {}) =>
        call('post', `/itineraries/${id}/bookings`, 'Reader').send({
          bookingType: 'hotel',
          bookingId: String(bookingId),
          ...extra,
        });

      const linked = await link(confirmed._id).expect(201);
      // Check-in falls on day 2 of the itinerary.
      expect(linked.body.days[1].linkedBookings[0]).toMatchObject({
        bookingType: 'hotel',
        status: 'confirmed',
        amountMinorUnits: 200_000,
        countsInBudget: true,
      });
      await link(confirmed._id).expect(409);
      await link(pending._id).expect(409);
      await link(someoneElses._id).expect(404);
      await link(offDates._id).expect(400);
      await link(offDates._id, { dayId: linked.body.days[2].id }).expect(201);

      const budget = await call(
        'get',
        `/itineraries/${id}/budget-summary?currency=EGP`,
        'Reader',
      ).expect(200);
      expect(budget.body.byCategory.accommodation).toBe(400_000);
      await m.hotelBookings.updateOne(
        { _id: offDates._id },
        { status: BookingStatus.CANCELLED },
      );
      const after = await call(
        'get',
        `/itineraries/${id}/budget-summary?currency=EGP`,
        'Reader',
      ).expect(200);
      expect(after.body.byCategory.accommodation).toBe(200_000);

      const linkId = linked.body.days[1].linkedBookings[0].id;
      const unlinked = await call(
        'delete',
        `/itineraries/${id}/bookings/${linkId}`,
        'Reader',
      ).expect(200);
      expect(unlinked.body.days[1].linkedBookings).toEqual([]);
    });
  });

  describe('admin analytics (BON-01)', () => {
    it('reports bookings and revenue per provider for a period', async () => {
      const [airlineA, airlineB] = await m.airlines.create([
        { name: 'Bonus Air A', code: 'BNA' },
        { name: 'Bonus Air B', code: 'BNB' },
      ]);
      const flight = await m.flightBookings.create({
        userId: ids.Reader,
        status: BookingStatus.CONFIRMED,
        reference: 'BNFLT1',
        holdExpiresAt: new Date(),
        policyAcceptedAt: new Date(),
        currency: 'EGP',
        totalMinorUnits: 4_000,
        segments: [airlineA, airlineB].map((airline) => ({
          flightId: new Types.ObjectId(),
          cabinInventoryId: new Types.ObjectId(),
          airlineId: airline._id,
          cabinClass: CabinClass.ECONOMY,
          cabinFareMinorUnits: airline === airlineA ? 1_000 : 3_000,
          freeBagCount: 1,
          maxBagWeightKg: 23,
          cancellationTiers: [],
        })),
        passengers: [
          {
            fullName: 'Pax',
            dateOfBirth: '1990-01-01',
            passportOrIdNumber: 'P123',
            segments: [
              {
                type: 'adult',
                fareMinorUnits: 1_000,
                extraBagWeightsKg: [],
                baggageFeeMinorUnits: 0,
              },
              {
                type: 'adult',
                fareMinorUnits: 3_000,
                extraBagWeightsKg: [],
                baggageFeeMinorUnits: 0,
              },
            ],
          },
        ],
      });
      const stay = await addHotelBooking(
        'Reader',
        BookingStatus.CANCELLED,
        day(5),
      );
      const [, hotelPayment] = await m.payments.create([
        {
          bookingModel: 'FlightBooking',
          bookingId: flight._id,
          stripePaymentIntentId: `pi_bonus_${flight.id}`,
          amountMinorUnits: 4_000,
          currency: 'EGP',
          status: PaymentStatus.SUCCEEDED,
        },
        {
          bookingModel: 'HotelBooking',
          bookingId: stay._id,
          stripePaymentIntentId: `pi_bonus_${stay.id}`,
          amountMinorUnits: 200_000,
          currency: 'EGP',
          status: PaymentStatus.SUCCEEDED,
        },
      ]);
      await m.refunds.create({
        paymentId: hotelPayment._id,
        amountMinorUnits: 50_000,
        currency: 'EGP',
        status: RefundStatus.REFUNDED,
        stripeRefundId: `re_bonus_${stay.id}`,
      });

      const report = await call('get', '/admin/analytics', 'Admin').expect(200);
      const row = (name: string) =>
        report.body.items.find((r: { name: string }) => r.name === name);
      expect(row('Bonus Air A')).toMatchObject({
        bookings: 1,
        grossRevenueMinorUnits: 1_000,
        netRevenueMinorUnits: 1_000,
      });
      expect(row('Bonus Air B')).toMatchObject({
        bookings: 1,
        grossRevenueMinorUnits: 3_000,
      });
      expect(row('Bonus Hotel')).toMatchObject({
        bookings: 1,
        cancelledBookings: 1,
        grossRevenueMinorUnits: 200_000,
        refundsMinorUnits: 50_000,
        netRevenueMinorUnits: 150_000,
      });
      expect(report.body).toMatchObject({ currency: 'EGP', pageSize: 10 });

      const hotelsOnly = await call(
        'get',
        '/admin/analytics?providerType=hotel',
        'Admin',
      ).expect(200);
      expect(
        hotelsOnly.body.items.every(
          (r: { providerType: string }) => r.providerType === 'hotel',
        ),
      ).toBe(true);
      const past = await call(
        'get',
        '/admin/analytics?fromDate=2020-01-01&toDate=2020-01-31',
        'Admin',
      ).expect(200);
      expect(past.body.totals.bookings).toBe(0);
      await call(
        'get',
        '/admin/analytics?fromDate=2026-12-01&toDate=2026-11-01',
        'Admin',
      ).expect(400);
      await call(
        'get',
        '/admin/analytics?fromDate=2020-01-01&toDate=2026-01-01',
        'Admin',
      ).expect(400);
      await call('get', '/admin/analytics', 'Reader').expect(403);
    });
  });
});
