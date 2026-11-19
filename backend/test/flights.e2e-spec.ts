import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { FlightStatusService } from '../src/flights/flight-status.service';
import {
  CabinInventory,
  CabinClass,
} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../src/flights/schemas/flight.schema';
import { flightTestContext } from './support/flight-test-context';

describe('Flight/cabin creation and departure status (FLT-03, FLT-04, FLT-30)', () => {
  let ctx: Awaited<ReturnType<typeof flightTestContext>>;
  let flights: Model<Flight>;
  let cabins: Model<CabinInventory>;
  const flightIds: Types.ObjectId[] = [];
  let departureId: string;
  let arrivalId: string;
  let flightId: string;
  const payload = () => ({
    flightNumber: ' ts 777 ',
    departureAirportId: departureId,
    arrivalAirportId: arrivalId,
    departureLocalDateTime: '2030-01-15T10:30',
    arrivalLocalDateTime: '2030-01-15T12:00',
  });
  const cabin = {
    cabinClass: CabinClass.ECONOMY,
    totalSeats: 100,
    priceMinorUnits: 15000,
    freeBagCount: 1,
    maxBagWeightKg: 23,
  };
  beforeAll(async () => {
    ctx = await flightTestContext('flights');
    flights = ctx.app.get(getModelToken(Flight.name));
    cabins = ctx.app.get(getModelToken(CabinInventory.name));
    await Promise.all([flights.init(), cabins.init()]);
    const airports = await ctx.airports.create([
      {
        iataCode: 'ZXA',
        name: 'Test Cairo',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'ZXB',
        name: 'Test London',
        cityId: 'london',
        countryCode: 'GB',
        timeZone: 'Europe/London',
      },
    ]);
    ctx.airportIds.push(...airports.map((a) => a._id));
    departureId = airports[0].id;
    arrivalId = airports[1].id;
  });
  afterAll(async () => {
    await cabins.deleteMany({ flightId: { $in: flightIds } });
    await flights.deleteMany({ _id: { $in: flightIds } });
    await ctx.cleanUp();
  });
  const post = (path = '/api/flights', role = 'moderator') =>
    request(ctx.app.getHttpServer())
      .post(path)
      .set('Cookie', ctx.cookies[role]);

  it('requires an airline moderator and prevents client-controlled airline/status', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/flights')
      .send(payload())
      .expect(401);
    for (const role of ['admin', 'traveler', 'hotel'])
      await post('/api/flights', role).send(payload()).expect(403);
    for (const extra of [{ airlineId: ctx.other.id }, { status: 'departed' }])
      await post()
        .send({ ...payload(), ...extra })
        .expect(400);
  });

  it('stores airport-local input in UTC, takes airline only from the current account and returns local times', async () => {
    const response = await post().send(payload()).expect(201);
    flightId = response.body._id;
    flightIds.push(new Types.ObjectId(flightId));
    expect(response.body).toMatchObject({
      airlineId: ctx.airline.id,
      flightNumber: 'TS777',
      status: 'scheduled',
      departureAt: '2030-01-15T08:30:00.000Z',
      arrivalAt: '2030-01-15T12:00:00.000Z',
      departureLocalDate: '2030-01-15',
      departureLocalDateTime: '2030-01-15T10:30',
      arrivalLocalDateTime: '2030-01-15T12:00',
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Europe/London',
    });
    const saved = await flights.findById(flightId);
    expect(saved!.departureAt.toISOString()).toBe('2030-01-15T08:30:00.000Z');
  });

  it('enforces local-date uniqueness atomically; permits another airline and another local date', async () => {
    await post().send(payload()).expect(409);
    const concurrent = await Promise.all(
      [1, 2].map(() => post().send({ ...payload(), flightNumber: 'RACE1' })),
    );
    expect(concurrent.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    flightIds.push(
      new Types.ObjectId(concurrent.find((r) => r.status === 201)!.body._id),
    );
    const other = await post('/api/flights', 'other')
      .send(payload())
      .expect(201);
    const next = await post()
      .send({
        ...payload(),
        departureLocalDateTime: '2030-01-16T10:30',
        arrivalLocalDateTime: '2030-01-16T12:00',
      })
      .expect(201);
    flightIds.push(
      new Types.ObjectId(other.body._id),
      new Types.ObjectId(next.body._id),
    );
  });

  it('rejects invalid airports/dates, past departures and arrival ordering in UTC', async () => {
    for (const changes of [
      { arrivalAirportId: departureId },
      { arrivalAirportId: departureId.toUpperCase() },
      { arrivalAirportId: new Types.ObjectId().toString() },
      { departureAirportId: 'CAI' },
      { departureLocalDateTime: '2030-02-30T10:30' },
      { departureLocalDateTime: '2030-01-15T10:30Z' },
      { departureLocalDateTime: '2020-01-15T10:30' },
      { arrivalLocalDateTime: '2030-01-15T08:00' },
      // Cairo 10:30 is London 08:30; equality also fails.
      { arrivalLocalDateTime: '2030-01-15T08:30' },
    ])
      await post()
        .send({ ...payload(), ...changes })
        .expect(400);
    // Apparent earlier local arrival is valid if it is later in UTC.
    const valid = await post()
      .send({
        ...payload(),
        flightNumber: 'TZ1',
        arrivalLocalDateTime: '2030-01-15T09:00',
      })
      .expect(201);
    flightIds.push(new Types.ObjectId(valid.body._id));
    await ctx.airlines.updateOne(
      { _id: ctx.airline._id },
      { $set: { isActive: false } },
    );
    await post()
      .send({ ...payload(), flightNumber: 'INACTIVE' })
      .expect(409);
    await ctx.airlines.updateOne(
      { _id: ctx.airline._id },
      { $set: { isActive: true } },
    );
  });

  it('only permits the flight owner to add cabins; checks 401/403/404', async () => {
    const path = `/api/flights/${flightId}/cabins`;
    await request(ctx.app.getHttpServer()).post(path).send(cabin).expect(401);
    for (const role of ['admin', 'traveler', 'hotel', 'other'])
      await post(path, role).send(cabin).expect(403);
    await post('/api/flights/not-an-id/cabins').send(cabin).expect(404);
    await post(`/api/flights/${new Types.ObjectId().toString()}/cabins`)
      .send(cabin)
      .expect(404);
    const attempts = await Promise.all(
      [1, 2].map(() => post(path).send(cabin)),
    );
    expect(attempts.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(attempts.find((r) => r.status === 201)!.body).toMatchObject({
      heldSeats: 0,
      bookedSeats: 0,
      seatsRemaining: 100,
    });
    for (const cabinClass of [
      CabinClass.PREMIUM_ECONOMY,
      CabinClass.BUSINESS,
      CabinClass.FIRST,
    ])
      await post(path)
        .send({ ...cabin, cabinClass })
        .expect(201);
    expect(await cabins.countDocuments({ flightId })).toBe(4);
  });

  it('validates cabin class, safe whole seat/fare counts, positive weight and server-owned inventory', async () => {
    const path = `/api/flights/${flightId}/cabins`;
    for (const changes of [
      { cabinClass: 'luxury' },
      { totalSeats: 0 },
      { totalSeats: 1.5 },
      { totalSeats: Number.MAX_SAFE_INTEGER + 1 },
      { priceMinorUnits: 0 },
      { priceMinorUnits: 1.1 },
      { freeBagCount: -1 },
      { maxBagWeightKg: 0 },
      { bookedSeats: 1 },
      { heldSeats: 1 },
    ]) {
      await post(path)
        .send({ ...cabin, ...changes })
        .expect(400);
    }
  });

  it('blocks cabins at departure immediately; persists departed flights while preserving cancelled/future states', async () => {
    const now = new Date();
    await flights.updateOne({ _id: flightId }, { $set: { departureAt: now } });
    await post(`/api/flights/${flightId}/cabins`).send(cabin).expect(409);
    const cancelled = await flights.create({
      airlineId: ctx.airline._id,
      flightNumber: 'CANCEL1',
      departureAirportId: departureId,
      arrivalAirportId: arrivalId,
      departureAt: new Date('2020-01-01T10:00Z'),
      arrivalAt: new Date('2020-01-01T12:00Z'),
      departureLocalDate: '2020-01-01',
      status: FlightStatus.CANCELLED,
    });
    flightIds.push(cancelled._id);
    await post(`/api/flights/${cancelled.id}/cabins`).send(cabin).expect(409);
    await ctx.app.get(FlightStatusService).markDeparted(now);
    expect((await flights.findById(flightId))!.status).toBe(
      FlightStatus.DEPARTED,
    );
    expect((await flights.findById(cancelled._id))!.status).toBe(
      FlightStatus.CANCELLED,
    );
    expect(
      await flights.countDocuments({
        _id: { $in: flightIds },
        status: FlightStatus.SCHEDULED,
      }),
    ).toBeGreaterThan(0);
  });
});
