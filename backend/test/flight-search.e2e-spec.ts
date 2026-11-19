import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import {
  CabinClass,
  CabinInventory,
} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../src/flights/schemas/flight.schema';
import { flightTestContext } from './support/flight-test-context';

describe('Flight search/details (FLT-11, FLT-12, FLT-15, FLT-17)', () => {
  let ctx: Awaited<ReturnType<typeof flightTestContext>>;
  let flights: Model<Flight>;
  let cabins: Model<CabinInventory>;
  let departureId: string;
  let arrivalId: string;
  let normalId: string;
  let cancelledId: string;
  let inactiveId: string;
  let pastId: string;
  const ids: Types.ObjectId[] = [];
  const query = () => ({
    departureAirportId: departureId,
    arrivalAirportId: arrivalId,
    departureDate: '2031-05-10',
  });
  const get = (extra: Record<string, unknown> = {}) =>
    request(ctx.app.getHttpServer())
      .get('/api/flights/search')
      .query({ ...query(), ...extra });

  async function createFlight(
    number: string,
    overrides: Partial<Flight> = {},
    inventory = true,
  ) {
    const flight = await flights.create({
      airlineId: ctx.airline._id,
      flightNumber: number,
      departureAirportId: departureId,
      arrivalAirportId: arrivalId,
      departureLocalDate: '2031-05-10',
      departureAt: new Date('2031-05-09T16:00Z'),
      arrivalAt: new Date('2031-05-09T18:00Z'),
      status: FlightStatus.SCHEDULED,
      ...overrides,
    });
    ids.push(flight._id);
    if (inventory)
      await cabins.create({
        flightId: flight._id,
        cabinClass: CabinClass.ECONOMY,
        totalSeats: 10,
        heldSeats: 2,
        bookedSeats: 3,
        priceMinorUnits: 1000,
        freeBagCount: 1,
        maxBagWeightKg: 23,
      });
    return flight;
  }

  beforeAll(async () => {
    ctx = await flightTestContext('search');
    flights = ctx.app.get(getModelToken(Flight.name));
    cabins = ctx.app.get(getModelToken(CabinInventory.name));
    const airports = await ctx.airports.create([
      {
        iataCode: 'XSA',
        name: 'Test Tokyo',
        cityId: 'tokyo',
        countryCode: 'JP',
        timeZone: 'Asia/Tokyo',
      },
      {
        iataCode: 'XSB',
        name: 'Test Honolulu',
        cityId: 'honolulu',
        countryCode: 'US',
        timeZone: 'Pacific/Honolulu',
      },
    ]);
    ctx.airportIds.push(...airports.map((a) => a._id));
    departureId = airports[0].id;
    arrivalId = airports[1].id;
    await ctx.airlines.updateOne(
      { _id: ctx.airline._id },
      {
        $set: {
          cancellationTiers: [{ daysBeforeDeparture: 7, refundPercentage: 80 }],
          extraBaggagePolicy: {
            pricePerBagMinorUnits: 500,
            maxExtraBagsPerPassenger: 2,
          },
        },
      },
    );
    for (let i = 0; i < 12; i++) {
      const departureAt = new Date(
        Date.parse('2031-05-09T16:00Z') + i * 600_000,
      );
      const f = await createFlight(
        `SEARCH${i}`,
        {
          departureAt,
          arrivalAt: new Date(departureAt.getTime() + (12 - i) * 3_600_000),
        },
        false,
      );
      if (i === 0) normalId = f.id;
      await cabins.create([
        {
          flightId: f._id,
          cabinClass: CabinClass.ECONOMY,
          totalSeats: 10,
          bookedSeats: 3,
          heldSeats: 2,
          priceMinorUnits: 1000 + i * 100,
          freeBagCount: 1,
          maxBagWeightKg: 23,
        },
        {
          flightId: f._id,
          cabinClass: CabinClass.BUSINESS,
          totalSeats: 2,
          bookedSeats: 0,
          heldSeats: 0,
          priceMinorUnits: 5000 + i * 100,
          freeBagCount: 2,
          maxBagWeightKg: 32,
        },
      ]);
    }
    cancelledId = (
      await createFlight('CANCELLED', { status: FlightStatus.CANCELLED })
    ).id;
    await createFlight('DEPARTED', { status: FlightStatus.DEPARTED });
    await createFlight('NO-CABINS', {}, false);
    const sold = await createFlight('SOLD');
    await cabins.updateOne({ flightId: sold._id }, { $set: { totalSeats: 5 } });
    await ctx.airlines.updateOne(
      { _id: ctx.other._id },
      { $set: { isActive: false } },
    );
    inactiveId = (await createFlight('INACTIVE', { airlineId: ctx.other._id }))
      .id;
    await createFlight('RETURN', {
      departureAirportId: new Types.ObjectId(arrivalId),
      arrivalAirportId: new Types.ObjectId(departureId),
      departureLocalDate: '2031-05-15',
      departureAt: new Date('2031-05-15T20:00Z'),
      arrivalAt: new Date('2031-05-16T08:00Z'),
    });
    pastId = (
      await createFlight('PAST', {
        departureLocalDate: '2020-01-01',
        departureAt: new Date('2020-01-01T10:00Z'),
        arrivalAt: new Date('2020-01-01T11:00Z'),
      })
    ).id;
    const split = await createFlight(
      'SPLIT',
      { departureLocalDate: '2031-05-11' },
      false,
    );
    for (const cabinClass of [CabinClass.ECONOMY, CabinClass.BUSINESS])
      await cabins.create({
        flightId: split._id,
        cabinClass,
        totalSeats: 2,
        priceMinorUnits: 1200,
        freeBagCount: 0,
        maxBagWeightKg: 20,
      });
  });
  afterAll(async () => {
    await cabins.deleteMany({ flightId: { $in: ids } });
    await flights.deleteMany({ _id: { $in: ids } });
    await ctx.cleanUp();
  });

  it('is public; searches local departure date, active airlines, future scheduled flights and actual remaining seats', async () => {
    const response = await get().expect(200);
    expect(response.body.tripType).toBe('one_way');
    expect(response.body.return).toBeUndefined();
    expect(response.body.outbound).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
    });
    expect(response.body.outbound.items).toHaveLength(10);
    const first = response.body.outbound.items[0];
    expect(first._id).toBe(normalId);
    expect(first.cabins[0].seatsRemaining).toBe(5);
    expect(first.departureLocalDateTime).toBe('2031-05-10T01:00');
    expect(first.departureAt).toBe('2031-05-09T16:00:00.000Z');
    const utcDate = await get({ departureDate: '2031-05-09' }).expect(200);
    expect(utcDate.body.outbound.items).toEqual([]);
    const past = await get({ departureDate: '2020-01-01' }).expect(200);
    expect(past.body.outbound.totalItems).toBe(0);
    await get().set('Cookie', ctx.cookies.traveler).expect(200);
  });

  it('paginates flights rather than duplicating them per cabin, with stable pages and empty out-of-range pages', async () => {
    const first = await get().expect(200);
    const second = await get({ page: 2 }).expect(200);
    expect(second.body.outbound.items).toHaveLength(2);
    const all = [
      ...first.body.outbound.items,
      ...second.body.outbound.items,
    ].map((item: { _id: string }) => item._id);
    expect(new Set(all).size).toBe(12);
    const beyond = await get({ page: 100 }).expect(200);
    expect(beyond.body.outbound.items).toEqual([]);
    expect(beyond.body.outbound.totalItems).toBe(12);
  });

  it('counts adults/children as seats, permits infants without seats, and requires enough seats in ONE cabin', async () => {
    const withInfants = await get({
      adults: 3,
      children: 2,
      infants: 3,
    }).expect(200);
    expect(withInfants.body.passengers).toEqual({
      adults: 3,
      children: 2,
      infants: 3,
      seatsRequired: 5,
    });
    expect(withInfants.body.outbound.totalItems).toBe(12);
    expect(
      withInfants.body.outbound.items[0].cabins.map(
        (c: { cabinClass: string }) => c.cabinClass,
      ),
    ).toEqual(['economy']);
    const tooMany = await get({ adults: 6 }).expect(200);
    expect(tooMany.body.outbound.items).toEqual([]);
    const split = await get({ departureDate: '2031-05-11', adults: 3 }).expect(
      200,
    );
    expect(split.body.outbound.items).toEqual([]);
    const business = await get({ cabinClass: 'business', adults: 2 }).expect(
      200,
    );
    expect(business.body.outbound.totalItems).toBe(12);
    expect(business.body.outbound.items[0].cabins[0].cabinClass).toBe(
      'business',
    );
    const empty = await get({ cabinClass: 'first' }).expect(200);
    expect(empty.body.outbound.items).toEqual([]);
  });

  it('applies inclusive prices to matching cabins while preserving route, date, party and cabin filters', async () => {
    const exact = await get({
      minPriceMinorUnits: 1000,
      maxPriceMinorUnits: 1000,
    }).expect(200);
    expect(exact.body.outbound.totalItems).toBe(1);
    expect(exact.body.outbound.items[0].priceMinorUnits).toBe(1000);
    const business = await get({
      minPriceMinorUnits: 5000,
      maxPriceMinorUnits: 5100,
      cabinClass: 'business',
      adults: 2,
    }).expect(200);
    expect(business.body.outbound.totalItems).toBe(2);
    expect(
      business.body.outbound.items.map(
        (f: { priceMinorUnits: number }) => f.priceMinorUnits,
      ),
    ).toEqual([5000, 5100]);
    expect(business.body.outbound.items[0].cabins).toHaveLength(1);
    const incompatible = await get({
      minPriceMinorUnits: 5000,
      maxPriceMinorUnits: 5100,
      cabinClass: 'economy',
    }).expect(200);
    expect(incompatible.body.outbound.totalItems).toBe(0);
  });

  it.each([
    ['price', 'asc', 'SEARCH0'],
    ['price', 'desc', 'SEARCH11'],
    ['duration', 'asc', 'SEARCH11'],
    ['duration', 'desc', 'SEARCH0'],
    ['departureTime', 'asc', 'SEARCH0'],
    ['departureTime', 'desc', 'SEARCH11'],
  ])(
    'sorts by %s %s before pagination',
    async (sortBy, sortOrder, firstFlight) => {
      const response = await get({
        sortBy,
        sortOrder,
        cabinClass: 'economy',
        adults: 2,
      }).expect(200);
      expect(response.body.outbound.items[0].flightNumber).toBe(firstFlight);
      expect(response.body.outbound.totalItems).toBe(12);
    },
  );

  it('returns reverse-route options for round trips with independent pagination and the same filters', async () => {
    const response = await get({
      returnDate: '2031-05-15',
      cabinClass: 'economy',
      maxPriceMinorUnits: 1500,
    }).expect(200);
    expect(response.body.tripType).toBe('round_trip');
    expect(response.body.outbound.totalItems).toBe(6);
    expect(response.body.return.totalItems).toBe(1);
    expect(response.body.return.items[0]).toMatchObject({
      flightNumber: 'RETURN',
      departureAirportId: arrivalId,
      arrivalAirportId: departureId,
      departureLocalDateTime: '2031-05-15T10:00',
    });
    const empty = await get({ returnDate: '2031-05-16' }).expect(200);
    expect(empty.body.return.items).toEqual([]);
    expect(empty.body.outbound.totalItems).toBe(12);
  });

  it('rejects malformed and inconsistent input with 400, without turning /search into an id lookup', async () => {
    for (const extra of [
      { departureAirportId: 'invalid' },
      { arrivalAirportId: departureId },
      { arrivalAirportId: departureId.toUpperCase() },
      { arrivalAirportId: new Types.ObjectId().toString() },
      { departureDate: '2031-02-29' },
      { departureDate: '2031-05-10T00:00Z' },
      { returnDate: '2031-05-09' },
      { returnDate: '2031-02-30' },
      { adults: 0 },
      { adults: 1.5 },
      { adults: -1 },
      { infants: 2 },
      { children: -1 },
      { children: '' },
      { adults: Number.MAX_SAFE_INTEGER, children: 1 },
      { cabinClass: 'luxury' },
      { minPriceMinorUnits: -1 },
      { minPriceMinorUnits: 100, maxPriceMinorUnits: 99 },
      { maxPriceMinorUnits: 1.5 },
      { maxPriceMinorUnits: '' },
      { sortBy: 'unknown' },
      { sortOrder: 'wrong' },
      { page: 0 },
      { page: 1.5 },
      { page: '9007199254740991' },
      { unexpected: 'value' },
    ])
      await get(extra).expect(400);
    await request(ctx.app.getHttpServer())
      .get('/api/flights/search')
      .expect(400);
  });

  it('shows public details with airports/local times/duration, every cabin, baggage and airline policies', async () => {
    const response = await request(ctx.app.getHttpServer())
      .get(`/api/flights/${normalId}`)
      .expect(200);
    expect(response.body).toMatchObject({
      _id: normalId,
      flightNumber: 'SEARCH0',
      durationMinutes: 720,
      departureTimeZone: 'Asia/Tokyo',
      arrivalTimeZone: 'Pacific/Honolulu',
      canBook: true,
    });
    expect(response.body.airline.cancellationTiers).toEqual([
      { daysBeforeDeparture: 7, refundPercentage: 80 },
    ]);
    expect(response.body.airline.extraBaggagePolicy.pricePerBagMinorUnits).toBe(
      500,
    );
    expect(response.body.departureAirport.iataCode).toBe('XSA');
    expect(response.body.cabins).toHaveLength(2);
    expect(response.body.cabins[0]).toMatchObject({
      cabinClass: 'economy',
      priceMinorUnits: 1000,
      seatsRemaining: 5,
      freeBagCount: 1,
      maxBagWeightKg: 23,
    });
    expect(response.body.cabins[0].heldSeats).toBeUndefined();
    expect(response.body.cabins[0]._id).toBeDefined();
    const cancelled = await request(ctx.app.getHttpServer())
      .get(`/api/flights/${cancelledId}`)
      .expect(200);
    expect(cancelled.body.canBook).toBe(false);
    const inactive = await request(ctx.app.getHttpServer())
      .get(`/api/flights/${inactiveId}`)
      .expect(200);
    expect(inactive.body.canBook).toBe(false);
    const past = await request(ctx.app.getHttpServer())
      .get(`/api/flights/${pastId}`)
      .expect(200);
    expect(past.body.status).toBe('departed');
    expect(past.body.canBook).toBe(false);
    await request(ctx.app.getHttpServer())
      .get('/api/flights/invalid')
      .expect(404);
    await request(ctx.app.getHttpServer())
      .get(`/api/flights/${new Types.ObjectId().toString()}`)
      .expect(404);
  });

  it('documents public reads with response schemas and leaves optional filters unfilled in Swagger', () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().setTitle('test').setVersion('1').build(),
    );
    const operation = document.paths['/api/flights/search'].get!;
    expect(operation.security ?? []).toEqual([]);
    expect(operation.responses['200']).toBeDefined();
    expect(operation.responses['400']).toBeDefined();
    const filters = operation.parameters ?? [];
    for (const filter of filters) {
      if (
        'name' in filter &&
        [
          'cabinClass',
          'returnDate',
          'minPriceMinorUnits',
          'maxPriceMinorUnits',
        ].includes(filter.name)
      ) {
        expect('example' in filter).toBe(false);
      }
    }
    expect(
      document.paths['/api/flights/{id}'].get!.responses['404'],
    ).toBeDefined();
  });
});
