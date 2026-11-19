import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Airline } from '../src/airlines/schemas/airline.schema';
import { Airport } from '../src/airports/schemas/airport.schema';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { Session } from '../src/auth/schemas/session.schema';
import { ExchangeRate } from '../src/exchange-rates/schemas/exchange-rate.schema';
import {
  CabinClass,
  CabinInventory,
} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../src/flights/schemas/flight.schema';
import { addDays, hotelNow } from '../src/hotels/hotel-dates';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { Itinerary } from '../src/itineraries/schemas/itinerary.schema';
import { City } from '../src/reference-data/schemas/city.schema';
import { Country } from '../src/reference-data/schemas/country.schema';
import { Currency } from '../src/reference-data/schemas/currency.schema';
import { User, UserRole, UserStatus } from '../src/users/schemas/user.schema';

const TAG = 'itn.e2e.test';
const PASSWORD = 'TestPassword2026';
const ALPHA = 'e2e-itn-alpha';
const BETA = 'e2e-itn-beta';
const GAMMA = 'e2e-itn-gamma';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

describe('Itineraries and budgeting (ITN-01 to ITN-26, e2e)', () => {
  let app: INestApplication<App>;
  let m: Record<string, Model<any>>;
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, Types.ObjectId> = {};
  const uploadsDir = mkdtempSync(join(tmpdir(), 'itn-uploads-'));
  const start = addDays(hotelNow('Africa/Cairo').date, 20);
  let fxAvailable = true;
  const fetchSpy = jest.spyOn(global, 'fetch');

  const server = () => app.getHttpServer();
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const req = request(server())[method](`/api${path}`);
    return who ? req.set('Cookie', cookies[who]) : req;
  };

  async function addUser(name: string, role: UserRole, extra = {}) {
    const user = await m.users.create({
      name,
      email: `${name.toLowerCase()}@${TAG}`,
      role,
      assignedProviderId:
        role === UserRole.HOTEL_MODERATOR ? new Types.ObjectId() : undefined,
      passwordHash: await app.get(PasswordHasherService).hash(PASSWORD),
      ...extra,
    });
    ids[name] = user._id;
    const login = await call('post', '/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    cookies[name] = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0]);
  }

  const create = (body: object = {}, who = 'Mona') =>
    call('post', '/itineraries', who).send({
      title: 'Desert loop',
      countryCodes: ['QX'],
      startDate: start,
      ...body,
    });

  async function withDays(cities: string[], who = 'Mona', body: object = {}) {
    const created = await create(body, who).expect(201);
    let details = created.body;
    for (const cityId of cities)
      details = (
        await call('post', `/itineraries/${created.body.id}/days`, who)
          .send({ cityId })
          .expect(201)
      ).body;
    return details;
  }

  async function cleanUp() {
    const users = await m.users.find({
      email: new RegExp(`@${TAG.replace(/\./g, '\\.')}$`),
    });
    const userIds = users.map((u) => u._id);
    await m.itineraries.deleteMany({ ownerId: { $in: userIds } });
    await app
      .get<Model<Session>>(getModelToken(Session.name))
      .deleteMany({ userId: { $in: userIds } });
    await m.users.deleteMany({ _id: { $in: userIds } });
    const hotel = await m.hotels.findOne({ cityId: ALPHA });
    if (hotel) {
      const rooms = (await m.rooms.find({ hotelId: hotel._id })).map(
        (r) => r._id,
      );
      await m.availability.deleteMany({ roomId: { $in: rooms } });
      await m.rooms.deleteMany({ hotelId: hotel._id });
      await m.hotels.deleteOne({ _id: hotel._id });
    }
    const airline = await m.airlines.findOne({ code: 'ITNE2E' });
    if (airline) {
      const flights = (await m.flights.find({ airlineId: airline._id })).map(
        (f) => f._id,
      );
      await m.cabins.deleteMany({ flightId: { $in: flights } });
      await m.flights.deleteMany({ _id: { $in: flights } });
      await m.airlines.deleteOne({ _id: airline._id });
    }
    await m.airports.deleteMany({ iataCode: { $in: ['XIA', 'XIB'] } });
    await m.cities.deleteMany({ _id: { $in: [ALPHA, BETA, GAMMA] } });
    await m.countries.deleteMany({ _id: { $in: ['QX', 'QY'] } });
  }

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
    // FXRatesAPI replaced by fixed rates: 1 EGP = 0.02 USD = 3 JPY.
    fetchSpy.mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes('fxratesapi')) throw new Error('unexpected fetch');
      if (!fxAvailable) throw new Error('FX API down');
      return new Response(
        JSON.stringify({
          success: true,
          date: '2026-11-19T00:00:00.000Z',
          rates: { EGP: 1, USD: 0.02, JPY: 3 },
        }),
      );
    });
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApp(app);
    await app.init();
    const model = (name: string) => app.get<Model<any>>(getModelToken(name));
    m = {
      users: model(User.name),
      itineraries: model(Itinerary.name),
      cities: model(City.name),
      countries: model(Country.name),
      currencies: model(Currency.name),
      rates: model(ExchangeRate.name),
      hotels: model(Hotel.name),
      rooms: model(Room.name),
      availability: model(RoomAvailability.name),
      airlines: model(Airline.name),
      airports: model(Airport.name),
      flights: model(Flight.name),
      cabins: model(CabinInventory.name),
    };
    await Promise.all(Object.values(m).map((x) => x.init()));
    await cleanUp();
    await m.rates.deleteMany({});
    for (const code of ['EGP', 'USD', 'JPY'])
      await m.currencies.updateOne(
        { _id: code },
        { $set: { _id: code } },
        { upsert: true },
      );
    await m.countries.create([
      { _id: 'QX', name: 'Testland', currencyCode: 'EGP' },
      { _id: 'QY', name: 'Otherland', currencyCode: 'USD' },
    ]);
    await m.cities.create([
      { _id: ALPHA, name: 'Alphaville', countryCode: 'QX' },
      { _id: BETA, name: 'Betatown', countryCode: 'QX' },
      { _id: GAMMA, name: 'Gamma City', countryCode: 'QY' },
    ]);
    await addUser('Mona', UserRole.TRAVELER, { preferredCurrency: 'USD' });
    await addUser('Omar', UserRole.TRAVELER);
    await addUser('Moderator', UserRole.HOTEL_MODERATOR);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
    fetchSpy.mockRestore();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  describe('itineraries and days (ITN-01 to ITN-09)', () => {
    it('creates private itineraries only for travelers, in known countries', async () => {
      const created = await create().expect(201);
      expect(created.body).toMatchObject({
        title: 'Desert loop',
        countryNames: ['Testland'],
        visibility: 'private',
        dayCount: 0,
        days: [],
      });
      await create({ countryCodes: ['ZZ'] }).expect(400);
      await create({ title: 'x'.repeat(101) }).expect(400);
      await create({ countryCodes: [] }).expect(400);
      await create({}, 'Moderator').expect(403);
      await call('post', '/itineraries').send({}).expect(401);
      await call('get', `/itineraries/${created.body.id}`, 'Omar').expect(404);
      const mine = await call('get', '/itineraries', 'Mona').expect(200);
      expect(mine.body.items[0].id).toBe(created.body.id);
    });

    it('numbers days, dates them from the start and groups cities', async () => {
      const details = await withDays([ALPHA, ALPHA, BETA]);
      expect(
        details.days.map((d: { number: number; date: string }) => [
          d.number,
          d.date,
        ]),
      ).toEqual([
        [1, start],
        [2, addDays(start, 1)],
        [3, addDays(start, 2)],
      ]);
      expect(details.groups).toEqual([
        expect.objectContaining({
          cityName: 'Alphaville',
          dayCount: 2,
          firstDay: 1,
          lastDay: 2,
        }),
        expect.objectContaining({
          cityName: 'Betatown',
          dayCount: 1,
          firstDay: 3,
        }),
      ]);
      const path = `/itineraries/${details.id}`;
      await call('post', `${path}/days`, 'Mona')
        .send({ cityId: GAMMA })
        .expect(400);
      await call('post', `${path}/days`, 'Mona')
        .send({ cityId: 'atlantis' })
        .expect(400);
      await call('post', `${path}/days`, 'Omar')
        .send({ cityId: ALPHA })
        .expect(404);

      // Move day 3 (Betatown) to the front.
      const moved = await call('patch', `${path}/days/reorder`, 'Mona')
        .send({ dayId: details.days[2].id, position: 1 })
        .expect(200);
      expect(moved.body.days.map((d: { cityId: string }) => d.cityId)).toEqual([
        BETA,
        ALPHA,
        ALPHA,
      ]);
      expect(moved.body.days[0].date).toBe(start);
      await call('patch', `${path}/days/reorder`, 'Mona')
        .send({ dayId: details.days[2].id, position: 9 })
        .expect(400);

      const edited = await call(
        'patch',
        `${path}/days/${details.days[0].id}`,
        'Mona',
      )
        .send({ notes: 'Pyramids at dawn' })
        .expect(200);
      expect(edited.body.days[1].notes).toBe('Pyramids at dawn');

      const removed = await call(
        'delete',
        `${path}/days/${moved.body.days[0].id}`,
        'Mona',
      ).expect(200);
      expect(
        removed.body.days.map((d: { number: number; date: string }) => [
          d.number,
          d.date,
        ]),
      ).toEqual([
        [1, start],
        [2, addDays(start, 1)],
      ]);
      expect(removed.body.groups).toHaveLength(1);

      // Countries used by days cannot be removed; start date moves all days.
      await call('patch', path, 'Mona')
        .send({ countryCodes: ['QY'] })
        .expect(400);
      const later = await call('patch', path, 'Mona')
        .send({ startDate: addDays(start, 5) })
        .expect(200);
      expect(later.body.days[0].date).toBe(addDays(start, 5));
    });

    it('allows at most 60 days', async () => {
      const details = await withDays([ALPHA]);
      const day = await m.itineraries.findById(details.id);
      day.days = Array.from({ length: 60 }, () => ({ cityId: ALPHA }));
      await day.save();
      const full = await call('post', `/itineraries/${details.id}/days`, 'Mona')
        .send({ cityId: ALPHA })
        .expect(400);
      expect(full.body.message).toMatch(/at most 60 days/);
    });
  });

  describe('activities, budgets, transport and the budget summary (ITN-10 to ITN-18)', () => {
    it('adds, edits and deletes entries, and totals them in one currency', async () => {
      const details = await withDays([ALPHA, ALPHA, BETA]);
      const [d1, , d3] = details.days;
      const path = `/itineraries/${details.id}`;

      const withActivity = await call(
        'post',
        `${path}/days/${d1.id}/activities`,
        'Mona',
      )
        .send({
          name: 'Museum',
          description: 'Morning visit',
          localTime: '10:30',
          cost: { amountMinorUnits: 1_500, currency: 'JPY' },
        })
        .expect(201);
      const activityId = withActivity.body.days[0].activities[0].id;
      await call('post', `${path}/days/${d1.id}/budgets`, 'Mona')
        .send({ category: 'food', amountMinorUnits: 50_000, currency: 'EGP' })
        .expect(201);
      const withBudget = await call(
        'post',
        `${path}/days/${d3.id}/budgets`,
        'Mona',
      )
        .send({
          category: 'accommodation',
          amountMinorUnits: 2_000,
          currency: 'USD',
          description: 'Hostel',
        })
        .expect(201);
      const budgetId = withBudget.body.days[2].budgetEntries[0].id;
      const withTransport = await call(
        'post',
        `${path}/transport-costs`,
        'Mona',
      )
        .send({
          dayId: d3.id,
          mode: 'Train',
          fromCityId: ALPHA,
          toCityId: BETA,
          amountMinorUnits: 10_000,
          currency: 'EGP',
        })
        .expect(201);
      expect(withTransport.body.days[2].transportCosts[0]).toMatchObject({
        fromCityName: 'Alphaville',
        toCityName: 'Betatown',
      });
      const transportId = withTransport.body.days[2].transportCosts[0].id;

      for (const body of [
        { category: 'food', amountMinorUnits: -1, currency: 'EGP' },
        { category: 'food', amountMinorUnits: 1, currency: 'XYZ' },
        { category: 'souvenirs', amountMinorUnits: 1, currency: 'EGP' },
      ])
        await call('post', `${path}/days/${d1.id}/budgets`, 'Mona')
          .send(body)
          .expect(400);
      await call('post', `${path}/transport-costs`, 'Mona')
        .send({
          dayId: d3.id,
          mode: 'Bus',
          fromCityId: ALPHA,
          toCityId: ALPHA,
          amountMinorUnits: 1,
          currency: 'EGP',
        })
        .expect(400);
      await call('patch', `/activities/${activityId}`, 'Omar')
        .send({ name: 'Mine now' })
        .expect(404);
      await call('patch', `/activities/${activityId}`, 'Mona')
        .send({ localTime: null })
        .expect(200);

      // Mona's preferred currency is USD:
      // food 500.00 EGP = 10.00 USD; museum 1500 JPY = 500.00 EGP = 10.00 USD;
      // hostel 20.00 USD; train 100.00 EGP = 2.00 USD.
      const usd = await call('get', `${path}/budget-summary`, 'Mona').expect(
        200,
      );
      expect(usd.body).toMatchObject({
        currency: 'USD',
        totalMinorUnits: 4_200,
        byCategory: {
          food: 1_000,
          activities: 1_000,
          accommodation: 2_000,
          intercity_transport: 200,
          in_city_transport: 0,
        },
        rateDate: '2026-11-19',
        ratesAreCached: false,
      });
      expect(
        usd.body.byDay.map(
          (d: { totalMinorUnits: number }) => d.totalMinorUnits,
        ),
      ).toEqual([2_000, 0, 2_200]);
      expect(
        usd.body.byGroup.map(
          (g: { subtotalMinorUnits: number }) => g.subtotalMinorUnits,
        ),
      ).toEqual([2_000, 2_200]);
      const egp = await call(
        'get',
        `${path}/budget-summary?currency=EGP`,
        'Mona',
      ).expect(200);
      expect(egp.body.totalMinorUnits).toBe(210_000);
      await call('get', `${path}/budget-summary?currency=XYZ`, 'Mona').expect(
        400,
      );

      // Edits and deletes flow into the totals.
      await call('patch', `/budgets/${budgetId}`, 'Mona')
        .send({ amountMinorUnits: 4_000 })
        .expect(200);
      await call('patch', `/transport-costs/${transportId}`, 'Mona')
        .send({ dayId: d1.id, mode: 'Bus' })
        .expect(200);
      const moved = await call('get', `${path}/budget-summary`, 'Mona').expect(
        200,
      );
      expect(moved.body.totalMinorUnits).toBe(6_200);
      expect(moved.body.byDay[0].byCategory.intercity_transport).toBe(200);
      await call('delete', `/activities/${activityId}`, 'Mona').expect(204);
      await call('delete', `/budgets/${budgetId}`, 'Mona').expect(204);
      await call('delete', `/transport-costs/${transportId}`, 'Mona').expect(
        204,
      );
      const after = await call('get', `${path}/budget-summary`, 'Mona').expect(
        200,
      );
      expect(after.body.totalMinorUnits).toBe(1_000);
    });

    it('uses cached rates when FXRatesAPI is down', async () => {
      const details = await withDays([ALPHA]);
      await m.rates.updateMany(
        {},
        { fetchedAt: new Date(Date.now() - 3 * 86_400_000) },
      );
      fxAvailable = false;
      try {
        const summary = await call(
          'get',
          `/itineraries/${details.id}/budget-summary`,
          'Mona',
        ).expect(200);
        expect(summary.body).toMatchObject({
          ratesAreCached: true,
          rateDate: '2026-11-19',
        });
        await m.rates.deleteMany({});
        await call(
          'get',
          `/itineraries/${details.id}/budget-summary`,
          'Mona',
        ).expect(503);
      } finally {
        fxAvailable = true;
      }
    });

    it('stores up to 5 JPG or PNG images per activity (ITN-12, GEN-08)', async () => {
      const details = await withDays([ALPHA]);
      const added = await call(
        'post',
        `/itineraries/${details.id}/days/${details.days[0].id}/activities`,
        'Mona',
      )
        .send({ name: 'Bazaar', description: 'Shopping' })
        .expect(201);
      const activityId = added.body.days[0].activities[0].id;
      const upload = (buffer: Buffer, name = 'photo.png') =>
        call('post', `/activities/${activityId}/images`, 'Mona').attach(
          'image',
          buffer,
          name,
        );

      const first = await upload(PNG).expect(201);
      const image = first.body.days[0].activities[0].images[0];
      expect(image.url).toMatch(/^\/uploads\/activities\/[\w-]+\.png$/);
      const served = await request(server()).get(image.url).expect(200);
      expect(served.headers['x-content-type-options']).toBe('nosniff');

      await upload(Buffer.from('<script>alert(1)</script>'), 'evil.png').expect(
        400,
      );
      await call('post', `/activities/${activityId}/images`, 'Mona').expect(
        400,
      );
      await upload(Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])).expect(
        413,
      );
      for (let i = 0; i < 4; i++) await upload(PNG).expect(201);
      await upload(PNG).expect(400);
      await call('post', `/activities/${activityId}/images`, 'Omar')
        .attach('image', PNG, 'x.png')
        .expect(404);

      await call(
        'delete',
        `/activities/${activityId}/images/${image.id}`,
        'Mona',
      ).expect(200);
      await request(server()).get(image.url).expect(404);
    });
  });

  describe('public itineraries and cloning (ITN-20, ITN-21)', () => {
    it('searches and shows only public, visible itineraries', async () => {
      const details = await withDays([ALPHA, BETA, BETA], 'Mona', {
        title: 'Sunrise Trail',
      });
      const id = details.id;
      await call(
        'post',
        `/itineraries/${id}/days/${details.days[0].id}/budgets`,
        'Mona',
      )
        .send({ category: 'food', amountMinorUnits: 10_000, currency: 'EGP' })
        .expect(201);
      const found = async (query: string) =>
        (
          (await call('get', `/itineraries/public/search?${query}`).expect(200))
            .body.items as { id: string }[]
        ).map((i) => i.id);

      expect(await found('keyword=sunrise')).not.toContain(id);
      await call('get', `/itineraries/public/${id}`).expect(404);

      await call('patch', `/itineraries/${id}`, 'Mona')
        .send({ visibility: 'public' })
        .expect(200);
      for (const query of [
        'keyword=sunrise',
        'keyword=betatown',
        'keyword=testland',
        `keyword=QX`,
        `cityId=${BETA}`,
        'countryCode=QX',
        'minDays=3&maxDays=3',
      ])
        expect(await found(query)).toContain(id);
      for (const query of [
        'keyword=nowhere',
        'countryCode=QY',
        'minDays=4',
        'maxDays=2',
      ])
        expect(await found(query)).not.toContain(id);
      await call(
        'get',
        '/itineraries/public/search?minDays=5&maxDays=1',
      ).expect(400);

      const view = await call(
        'get',
        `/itineraries/public/${id}?currency=USD`,
      ).expect(200);
      expect(view.body).toMatchObject({
        authorName: 'Mona',
        dayCount: 3,
        budget: { currency: 'USD', totalMinorUnits: 200 },
      });
      await call('patch', `/itineraries/${id}`, 'Omar')
        .send({ title: 'Mine' })
        .expect(404);

      // Deactivated authors' itineraries are hidden (ACC-12); so are hidden ones (GEN-10).
      await m.users.updateOne(
        { _id: ids.Mona },
        { status: UserStatus.DEACTIVATED },
      );
      expect(await found('keyword=sunrise')).not.toContain(id);
      await call('get', `/itineraries/public/${id}`).expect(404);
      await m.users.updateOne({ _id: ids.Mona }, { status: UserStatus.ACTIVE });
      await m.itineraries.updateOne({ _id: id }, { hiddenAt: new Date() });
      await call('get', `/itineraries/public/${id}`).expect(404);
      await m.itineraries.updateOne({ _id: id }, { $unset: { hiddenAt: 1 } });

      await call('patch', `/itineraries/${id}`, 'Mona')
        .send({ visibility: 'private' })
        .expect(200);
      expect(await found('keyword=sunrise')).not.toContain(id);
    });

    it('clones a public itinerary as a private, independent copy crediting the author', async () => {
      const details = await withDays([ALPHA], 'Mona', { title: 'Clone me' });
      const added = await call(
        'post',
        `/itineraries/${details.id}/days/${details.days[0].id}/activities`,
        'Mona',
      )
        .send({ name: 'Walk', description: 'Old town' })
        .expect(201);
      const activityId = added.body.days[0].activities[0].id;
      await call('post', `/activities/${activityId}/images`, 'Mona')
        .attach('image', PNG, 'a.png')
        .expect(201);

      await call('post', `/itineraries/${details.id}/clone`, 'Omar').expect(
        404,
      );
      await call('patch', `/itineraries/${details.id}`, 'Mona')
        .send({ visibility: 'public' })
        .expect(200);
      const clone = await call(
        'post',
        `/itineraries/${details.id}/clone`,
        'Omar',
      ).expect(201);
      expect(clone.body).toMatchObject({
        title: 'Clone me',
        visibility: 'private',
        dayCount: 1,
        clonedFrom: {
          sourceItineraryId: details.id,
          originalAuthorName: 'Mona',
        },
      });
      const cloneImage = clone.body.days[0].activities[0].images[0].url;
      await request(server()).get(cloneImage).expect(200);

      // Independent: deleting the original keeps the clone and its image.
      await call('delete', `/itineraries/${details.id}`, 'Mona').expect(204);
      const kept = await call(
        'get',
        `/itineraries/${clone.body.id}`,
        'Omar',
      ).expect(200);
      expect(kept.body.days[0].activities[0].name).toBe('Walk');
      await request(server()).get(cloneImage).expect(200);

      // A clone of a clone still credits the first author.
      await call('patch', `/itineraries/${clone.body.id}`, 'Omar')
        .send({ visibility: 'public' })
        .expect(200);
      const second = await call(
        'post',
        `/itineraries/${clone.body.id}/clone`,
        'Mona',
      ).expect(201);
      expect(second.body.clonedFrom).toMatchObject({
        sourceItineraryId: clone.body.id,
        originalAuthorName: 'Mona',
      });
    });
  });

  describe('hotels and flights from an itinerary (ITN-25, ITN-26)', () => {
    it('searches hotels for a city group and flights to the first city', async () => {
      const details = await withDays([ALPHA, ALPHA, BETA]);
      const hotel = await m.hotels.create({
        name: 'Alpha Inn',
        address: '1 Main St',
        cityId: ALPHA,
        countryCode: 'QX',
        timeZone: 'Africa/Cairo',
        description: 'x',
        starClass: 3,
        policy: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [],
        },
      });
      const room = await m.rooms.create({
        hotelId: hotel._id,
        label: '1',
        roomType: 'Double',
        bedCount: 1,
        maxOccupancy: 2,
        nightlyPriceMinorUnits: 100_000,
      });
      await m.availability.create({
        roomId: room._id,
        bookableRanges: [{ fromDate: start, untilDate: addDays(start, 30) }],
      });

      const hotels = await call(
        'get',
        `/itineraries/${details.id}/hotels?group=1&guests=2`,
        'Mona',
      ).expect(200);
      expect(hotels.body.group).toMatchObject({ cityId: ALPHA, dayCount: 2 });
      expect(hotels.body.results).toMatchObject({
        checkInDate: start,
        checkOutDate: addDays(start, 2),
        nights: 2,
      });
      expect(
        hotels.body.results.items.map((i: { name: string }) => i.name),
      ).toContain('Alpha Inn');
      await call(
        'get',
        `/itineraries/${details.id}/hotels?group=9&guests=2`,
        'Mona',
      ).expect(400);
      await call(
        'get',
        `/itineraries/${details.id}/hotels?group=1&guests=2`,
        'Omar',
      ).expect(404);

      const airline = await m.airlines.create({
        name: 'Itn Air',
        code: 'ITNE2E',
      });
      const [destination, origin] = await m.airports.create([
        {
          iataCode: 'XIA',
          name: 'Alpha Airport',
          cityId: ALPHA,
          countryCode: 'QX',
          timeZone: 'Africa/Cairo',
        },
        {
          iataCode: 'XIB',
          name: 'Gamma Airport',
          cityId: GAMMA,
          countryCode: 'QY',
          timeZone: 'Africa/Cairo',
        },
      ]);
      const departureAt = new Date(`${start}T08:00:00Z`);
      const flight = await m.flights.create({
        airlineId: airline._id,
        flightNumber: 'ITN1',
        departureAirportId: origin._id,
        arrivalAirportId: destination._id,
        departureAt,
        arrivalAt: new Date(departureAt.getTime() + 3 * 3_600_000),
        departureLocalDate: start,
        status: FlightStatus.SCHEDULED,
      });
      await m.cabins.create({
        flightId: flight._id,
        cabinClass: CabinClass.ECONOMY,
        totalSeats: 10,
        priceMinorUnits: 1_000,
        freeBagCount: 1,
        maxBagWeightKg: 23,
      });

      const flights = await call(
        'get',
        `/itineraries/${details.id}/flights?originAirportId=${origin._id.toString()}`,
        'Mona',
      ).expect(200);
      expect(flights.body).toMatchObject({
        cityName: 'Alphaville',
        departureDate: start,
        tripType: 'one_way',
      });
      expect(flights.body.destinations[0].airport.iataCode).toBe('XIA');
      const found = JSON.stringify(flights.body.destinations[0].results);
      expect(found).toContain('ITN1');
      const roundTrip = await call(
        'get',
        `/itineraries/${details.id}/flights?originAirportId=${origin._id.toString()}&tripType=round_trip`,
        'Mona',
      ).expect(200);
      expect(roundTrip.body.returnDate).toBe(addDays(start, 2));
      await call(
        'get',
        `/itineraries/${details.id}/flights?originAirportId=${new Types.ObjectId().toString()}`,
        'Mona',
      ).expect(404);
    });
  });
});
