import { Types } from 'mongoose';
import request from 'supertest';
import { flightTestContext } from './support/flight-test-context';

describe('Airlines and airports (FLT-01, FLT-02, FLT-08, FLT-09)', () => {
  let ctx: Awaited<ReturnType<typeof flightTestContext>>;
  beforeAll(async () => {
    ctx = await flightTestContext('airlines');
  });
  afterAll(async () => {
    await ctx.cleanUp();
  });

  it('lets only admins create airlines and handles duplicate codes, including simultaneous requests', async () => {
    const code = `NEW-${new Types.ObjectId().toString().slice(-8)}`;
    await request(ctx.app.getHttpServer())
      .post('/api/airlines')
      .send({ name: 'Test', code })
      .expect(401);
    for (const role of ['traveler', 'moderator', 'hotel']) {
      await request(ctx.app.getHttpServer())
        .post('/api/airlines')
        .set('Cookie', ctx.cookies[role])
        .send({ name: 'Test', code })
        .expect(403);
    }
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(ctx.app.getHttpServer())
          .post('/api/airlines')
          .set('Cookie', ctx.cookies.admin)
          .send({ name: 'Test', code: code.toLowerCase() }),
      ),
    );
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const created = responses.find((r) => r.status === 201)!;
    ctx.airlineIds.push(new Types.ObjectId(created.body._id));
    expect(created.body.code).toBe(code.toUpperCase());
    await request(ctx.app.getHttpServer())
      .post('/api/airlines')
      .set('Cookie', ctx.cookies.admin)
      .send({ name: ' ', code: ' ', isActive: false })
      .expect(400);
  });

  it('allows public viewing, with 404 for missing and malformed ids', async () => {
    const response = await request(ctx.app.getHttpServer())
      .get(`/api/airlines/${ctx.airline.id}`)
      .expect(200);
    expect(response.body.code).toBe(ctx.airline.code);
    await request(ctx.app.getHttpServer())
      .get('/api/airlines/invalid')
      .expect(404);
    await request(ctx.app.getHttpServer())
      .get(`/api/airlines/${new Types.ObjectId().toString()}`)
      .expect(404);
  });

  it('only lets the assigned airline moderator change profile and policies', async () => {
    const path = `/api/airlines/${ctx.airline.id}`;
    await request(ctx.app.getHttpServer())
      .patch(path)
      .send({ name: 'Changed' })
      .expect(401);
    for (const role of ['admin', 'traveler', 'hotel', 'other']) {
      await request(ctx.app.getHttpServer())
        .patch(path)
        .set('Cookie', ctx.cookies[role])
        .send({ name: 'Changed' })
        .expect(403);
      await request(ctx.app.getHttpServer())
        .put(`${path}/baggage-policy`)
        .set('Cookie', ctx.cookies[role])
        .send({ pricePerBagMinorUnits: 1200, maxExtraBagsPerPassenger: 0 })
        .expect(403);
      await request(ctx.app.getHttpServer())
        .put(`${path}/cancellation-policy`)
        .set('Cookie', ctx.cookies[role])
        .send({ cancellationTiers: [] })
        .expect(403);
    }
    const changed = await request(ctx.app.getHttpServer())
      .patch(path)
      .set('Cookie', ctx.cookies.moderator)
      .send({ name: 'Changed' })
      .expect(200);
    expect(changed.body.name).toBe('Changed');
    for (const body of [
      {},
      { name: null },
      { code: '' },
      { logoUrl: 'javascript:alert(1)' },
      { isActive: false },
    ]) {
      await request(ctx.app.getHttpServer())
        .patch(path)
        .set('Cookie', ctx.cookies.moderator)
        .send(body)
        .expect(400);
    }
    await request(ctx.app.getHttpServer())
      .patch(path)
      .set('Cookie', ctx.cookies.moderator)
      .send({ code: ctx.other.code })
      .expect(409);
    await request(ctx.app.getHttpServer())
      .put(`${path}/baggage-policy`)
      .set('Cookie', ctx.cookies.moderator)
      .send({ pricePerBagMinorUnits: 1200, maxExtraBagsPerPassenger: 0 })
      .expect(200);
    for (const body of [
      { pricePerBagMinorUnits: 0, maxExtraBagsPerPassenger: 1 },
      { pricePerBagMinorUnits: 1.5, maxExtraBagsPerPassenger: 1 },
      { pricePerBagMinorUnits: 100, maxExtraBagsPerPassenger: -1 },
    ]) {
      await request(ctx.app.getHttpServer())
        .put(`${path}/baggage-policy`)
        .set('Cookie', ctx.cookies.moderator)
        .send(body)
        .expect(400);
    }
    const tiers = [
      { daysBeforeDeparture: 0, refundPercentage: 0 },
      { daysBeforeDeparture: 7, refundPercentage: 80 },
    ];
    const policy = await request(ctx.app.getHttpServer())
      .put(`${path}/cancellation-policy`)
      .set('Cookie', ctx.cookies.moderator)
      .send({ cancellationTiers: tiers })
      .expect(200);
    expect(policy.body.cancellationTiers).toEqual(tiers);
    for (const cancellationTiers of [
      [tiers[0], tiers[0]],
      [{ daysBeforeDeparture: -1, refundPercentage: 10 }],
      [{ daysBeforeDeparture: 0, refundPercentage: 101 }],
      [null],
      null,
    ]) {
      await request(ctx.app.getHttpServer())
        .put(`${path}/cancellation-policy`)
        .set('Cookie', ctx.cookies.moderator)
        .send({ cancellationTiers })
        .expect(400);
    }
    expect(
      (await ctx.airlines.findById(ctx.airline._id))!.cancellationTiers,
    ).toHaveLength(2);
  });

  it('returns a read-only, searched, paginated airport list and rejects invalid query input', async () => {
    const prefix = `Fixture ${new Types.ObjectId().toString()}`;
    const rows = await ctx.airports.create(
      Array.from({ length: 12 }, (_, i) => ({
        iataCode: `Q${String.fromCharCode(65 + i)}Z`,
        name: `${prefix} ${i}`,
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      })),
    );
    ctx.airportIds.push(...rows.map((r) => r._id));
    const first = await request(ctx.app.getHttpServer())
      .get('/api/airports')
      .query({ search: prefix })
      .expect(200);
    expect(first.body.items).toHaveLength(10);
    expect(first.body.totalItems).toBe(12);
    expect(first.body.items[0].timeZone).toBe('Africa/Cairo');
    const second = await request(ctx.app.getHttpServer())
      .get('/api/airports')
      .query({ search: prefix, page: 2, countryCode: 'eg' })
      .expect(200);
    expect(second.body.items).toHaveLength(2);
    const empty = await request(ctx.app.getHttpServer())
      .get('/api/airports')
      .query({ search: '.*' })
      .expect(200);
    expect(empty.body.items).toEqual([]);
    for (const query of [
      { page: 0 },
      { page: 1.5 },
      { countryCode: 'invalid' },
      { unexpected: true },
    ]) {
      await request(ctx.app.getHttpServer())
        .get('/api/airports')
        .query(query)
        .expect(400);
    }
    await request(ctx.app.getHttpServer())
      .post('/api/airports')
      .set('Cookie', ctx.cookies.admin)
      .send({})
      .expect(404);
  });
});
