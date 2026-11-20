import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { BookingStatus } from '../src/common/booking-status';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import {
  CabinClass,
  CabinInventory,
} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../src/flights/schemas/flight.schema';
import {
  Notification,
  NotificationType,
} from '../src/notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../src/payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../src/payments/schemas/refund.schema';
import { flightTestContext } from './support/flight-test-context';

describe('Flight editing, cancellation and moderator views (FLT-05, FLT-06, FLT-29)', () => {
  let ctx: Awaited<ReturnType<typeof flightTestContext>>;
  let flights: Model<Flight>;
  let cabins: Model<CabinInventory>;
  let bookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let notifications: Model<Notification>;
  const flightIds: Types.ObjectId[] = [];
  const bookingIds: Types.ObjectId[] = [];
  const paymentIds: Types.ObjectId[] = [];
  let departureId: string;
  let arrivalId: string;
  let thirdId: string;
  let ownerId: Types.ObjectId;
  let sequence = 0;

  async function makeFlight(status = FlightStatus.SCHEDULED) {
    const f = await flights.create({
      airlineId: ctx.airline._id,
      flightNumber: `MANAGE${sequence++}`,
      departureAirportId: departureId,
      arrivalAirportId: arrivalId,
      departureAt: new Date('2031-01-15T08:00Z'),
      arrivalAt: new Date('2031-01-15T12:00Z'),
      departureLocalDate: '2031-01-15',
      status,
    });
    flightIds.push(f._id);
    const c = await cabins.create({
      flightId: f._id,
      cabinClass: CabinClass.ECONOMY,
      totalSeats: 100,
      priceMinorUnits: 1000,
      freeBagCount: 1,
      maxBagWeightKg: 23,
    });
    return { f, c };
  }
  async function makeBooking(
    legs: Awaited<ReturnType<typeof makeFlight>>[],
    pending = false,
    name = 'Test Passenger',
    withPayment = true,
  ) {
    const booking = await bookings.create({
      userId: ownerId,
      status: pending ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
      reference: pending ? undefined : `REF-${new Types.ObjectId().toString()}`,
      policyAcceptedAt: pending ? undefined : new Date(),
      holdExpiresAt: new Date(Date.now() + 600_000),
      currency: 'USD',
      totalMinorUnits: 1000 * legs.length,
      segments: legs.map(({ f, c }) => ({
        flightId: f._id,
        cabinInventoryId: c._id,
        airlineId: f.airlineId,
        cabinClass: c.cabinClass,
        cabinFareMinorUnits: 1000,
        freeBagCount: 1,
        maxBagWeightKg: 23,
        cancellationTiers: [],
      })),
      passengers: [
        {
          fullName: name,
          dateOfBirth: '2000-01-01',
          passportOrIdNumber: 'TEST-PASSPORT-PRIVATE',
          segments: legs.map(() => ({
            type: 'adult',
            fareMinorUnits: 1000,
            extraBagWeightsKg: [],
            baggageFeeMinorUnits: 0,
          })),
        },
      ],
    });
    bookingIds.push(booking._id);
    for (const { c } of legs)
      await cabins.updateOne(
        { _id: c._id },
        { $inc: { [pending ? 'heldSeats' : 'bookedSeats']: 1 } },
      );
    if (!pending && withPayment) {
      const p = await payments.create({
        bookingModel: 'FlightBooking',
        bookingId: booking._id,
        stripePaymentIntentId: `pi_test_${booking.id}`,
        amountMinorUnits: booking.totalMinorUnits,
        currency: 'USD',
        status: PaymentStatus.SUCCEEDED,
      });
      paymentIds.push(p._id);
    }
    return booking;
  }
  const api = (
    method: 'get' | 'patch' | 'post',
    path: string,
    role = 'moderator',
  ) =>
    request(ctx.app.getHttpServer())
      [method](path)
      .set('Cookie', ctx.cookies[role]);

  beforeAll(async () => {
    ctx = await flightTestContext('management');
    flights = ctx.app.get(getModelToken(Flight.name));
    cabins = ctx.app.get(getModelToken(CabinInventory.name));
    bookings = ctx.app.get(getModelToken(FlightBooking.name));
    payments = ctx.app.get(getModelToken(Payment.name));
    refunds = ctx.app.get(getModelToken(Refund.name));
    notifications = ctx.app.get(getModelToken(Notification.name));
    await Promise.all([
      flights.init(),
      cabins.init(),
      bookings.init(),
      payments.init(),
      refunds.init(),
      notifications.init(),
    ]);
    ownerId = (await ctx.users.findOne({
      email: /@management.e2e.test$/,
      role: 'traveler',
    }))!._id;
    const airports = await ctx.airports.create([
      {
        iataCode: 'MGA',
        name: 'Test Cairo',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'MGB',
        name: 'Test London',
        cityId: 'london',
        countryCode: 'GB',
        timeZone: 'Europe/London',
      },
      {
        iataCode: 'MGC',
        name: 'Test Tokyo',
        cityId: 'tokyo',
        countryCode: 'JP',
        timeZone: 'Asia/Tokyo',
      },
    ]);
    ctx.airportIds.push(...airports.map((a) => a._id));
    [departureId, arrivalId, thirdId] = airports.map((a) => a.id);
  });
  afterAll(async () => {
    await refunds.deleteMany({ paymentId: { $in: paymentIds } });
    await payments.deleteMany({ _id: { $in: paymentIds } });
    await notifications.deleteMany({
      $or: [
        { subjectId: { $in: flightIds } },
        { subjectId: { $in: bookingIds } },
      ],
    });
    await bookings.deleteMany({ _id: { $in: bookingIds } });
    await cabins.deleteMany({ flightId: { $in: flightIds } });
    await flights.deleteMany({ _id: { $in: flightIds } });
    await ctx.cleanUp();
  });

  it('enforces login, role and provider ownership for every management endpoint', async () => {
    const { f, c } = await makeFlight();
    const cases = [
      [
        'patch',
        `/api/flights/${f.id}`,
        { arrivalLocalDateTime: '2031-01-15T13:00' },
      ],
      ['patch', `/api/flights/${f.id}/cabins/${c.id}`, { totalSeats: 101 }],
      ['post', `/api/flights/${f.id}/cancel`, { confirm: true }],
      ['get', `/api/flights/${f.id}/bookings`, undefined],
      ['get', `/api/flights/${f.id}/passengers/export`, undefined],
    ] as const;
    for (const [method, path, body] of cases) {
      const anonymous = request(ctx.app.getHttpServer())[method](path);
      if (body) anonymous.send(body);
      await anonymous.expect(401);
      for (const role of ['admin', 'traveler', 'hotel', 'other']) {
        const call = api(method, path, role);
        if (body) call.send(body);
        await call.expect(403);
      }
    }
  });

  it('validates flight edits, converts local times and notifies only confirmed booking owners once per time change', async () => {
    const leg = await makeFlight();
    const confirmed = await makeBooking([leg]);
    await makeBooking([leg]);
    await makeBooking([leg], true);
    const before = await notifications.countDocuments({ subjectId: leg.f._id });
    const response = await api('patch', `/api/flights/${leg.f.id}`)
      .send({
        departureLocalDateTime: '2031-01-15T11:00',
        arrivalLocalDateTime: '2031-01-15T13:00',
      })
      .expect(200);
    expect(response.body.departureAt).toBe('2031-01-15T09:00:00.000Z');
    expect(
      await notifications.countDocuments({
        subjectId: leg.f._id,
        type: NotificationType.FLIGHT_SCHEDULE_CHANGED,
      }),
    ).toBe(before + 1);
    await api('patch', `/api/flights/${leg.f.id}`)
      .send({ departureLocalDateTime: '2031-01-15T11:00' })
      .expect(200);
    expect(await notifications.countDocuments({ subjectId: leg.f._id })).toBe(
      before + 1,
    );
    await api('patch', `/api/flights/${leg.f.id}`)
      .send({ departureAirportId: thirdId })
      .expect(409);
    for (const body of [
      {},
      { departureLocalDateTime: null },
      { departureLocalDateTime: '2031-02-30T11:00' },
      { arrivalLocalDateTime: '2031-01-15T08:00' },
      { departureLocalDateTime: '2020-01-01T11:00' },
      { status: 'cancelled' },
    ])
      await api('patch', `/api/flights/${leg.f.id}`).send(body).expect(400);
    await api('patch', `/api/flights/${leg.f.id}/cabins/${leg.c.id}`)
      .send({ priceMinorUnits: 1200 })
      .expect(200);
    expect(
      (await bookings.findById(confirmed._id))!.segments[0].cabinFareMinorUnits,
    ).toBe(1000);
  });

  it('allows airport changes before any booking and rejects unknown airports and duplicate local-date flights', async () => {
    const a = await makeFlight();
    await api('patch', `/api/flights/${a.f.id}`)
      .send({ arrivalAirportId: thirdId })
      .expect(200);
    await api('patch', `/api/flights/${a.f.id}`)
      .send({ arrivalAirportId: new Types.ObjectId().toString() })
      .expect(400);
    await api('patch', `/api/flights/${a.f.id}`)
      .send({ arrivalAirportId: departureId })
      .expect(400);
    const duplicate = await flights.create({
      airlineId: a.f.airlineId,
      flightNumber: a.f.flightNumber,
      departureAirportId: departureId,
      arrivalAirportId: arrivalId,
      departureAt: new Date('2031-01-16T08:00Z'),
      arrivalAt: new Date('2031-01-16T12:00Z'),
      departureLocalDate: '2031-01-16',
    });
    flightIds.push(duplicate._id);
    await api('patch', `/api/flights/${duplicate.id}`)
      .send({
        departureLocalDateTime: '2031-01-15T10:00',
        arrivalLocalDateTime: '2031-01-15T12:00',
      })
      .expect(409);
    expect((await flights.findById(duplicate.id))!.departureLocalDate).toBe(
      '2031-01-16',
    );
  });

  it('guards capacity atomically, forbids inventory counter/class injection, and rejects a cabin belonging to another flight', async () => {
    const a = await makeFlight();
    const b = await makeFlight();
    await makeBooking([a]);
    await makeBooking([a], true);
    await api('patch', `/api/flights/${a.f.id}/cabins/${a.c.id}`)
      .send({ totalSeats: 1 })
      .expect(409);
    const changed = await api(
      'patch',
      `/api/flights/${a.f.id}/cabins/${a.c.id}`,
    )
      .send({ totalSeats: 2, freeBagCount: 2, maxBagWeightKg: 30 })
      .expect(200);
    expect(changed.body.seatsRemaining).toBe(0);
    for (const body of [
      {},
      { bookedSeats: 0 },
      { heldSeats: 0 },
      { cabinClass: 'first' },
      { totalSeats: 1.5 },
      { priceMinorUnits: 0 },
      { maxBagWeightKg: 0 },
    ])
      await api('patch', `/api/flights/${a.f.id}/cabins/${a.c.id}`)
        .send(body)
        .expect(400);
    await api('patch', `/api/flights/${a.f.id}/cabins/${b.c.id}`)
      .send({ totalSeats: 10 })
      .expect(404);
    await api('patch', `/api/flights/${a.f.id}/cabins/invalid`)
      .send({ totalSeats: 10 })
      .expect(404);
    // Two concurrent reductions cannot bypass the booked+held floor.
    const results = await Promise.all(
      [1, 2].map(() =>
        api('patch', `/api/flights/${a.f.id}/cabins/${a.c.id}`).send({
          totalSeats: 1,
        }),
      ),
    );
    expect(results.map((x) => x.status)).toEqual([409, 409]);
    expect((await cabins.findById(a.c._id))!.totalSeats).toBe(2);
  });

  it('refuses edits/cabins/cancellation after departure or cancellation, and returns 404 for missing flights', async () => {
    for (const status of [FlightStatus.CANCELLED, FlightStatus.DEPARTED]) {
      const a = await makeFlight(status);
      await api('patch', `/api/flights/${a.f.id}`)
        .send({ arrivalLocalDateTime: '2031-01-15T14:00' })
        .expect(409);
      await api('patch', `/api/flights/${a.f.id}/cabins/${a.c.id}`)
        .send({ totalSeats: 10 })
        .expect(409);
      await api('post', `/api/flights/${a.f.id}/cancel`)
        .send({ confirm: true })
        .expect(409);
    }
    const past = await makeFlight();
    await flights.updateOne(
      { _id: past.f._id },
      { $set: { departureAt: new Date('2020-01-01T00:00Z') } },
    );
    await api('patch', `/api/flights/${past.f.id}`)
      .send({ arrivalLocalDateTime: '2031-01-15T14:00' })
      .expect(409);
    await api('patch', '/api/flights/invalid')
      .send({ arrivalLocalDateTime: '2031-01-15T14:00' })
      .expect(404);
    await api('post', `/api/flights/${new Types.ObjectId().toString()}/cancel`)
      .send({ confirm: true })
      .expect(404);
  });

  it('requires explicit cancellation confirmation, cancels entire round trips, releases both-leg seats, and queues a full refund once', async () => {
    const a = await makeFlight();
    const b = await makeFlight();
    const confirmed = await makeBooking([a, b]);
    const pending = await makeBooking([a, b], true);
    for (const body of [{}, { confirm: false }, { confirm: 'true' }])
      await api('post', `/api/flights/${a.f.id}/cancel`).send(body).expect(400);
    const response = await api('post', `/api/flights/${a.f.id}/cancel`)
      .send({ confirm: true })
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'cancelled',
      cancelledBookings: 1,
      expiredHolds: 1,
      pendingRefunds: 1,
    });
    expect((await flights.findById(a.f.id))!.status).toBe('cancelled');
    expect((await flights.findById(b.f.id))!.status).toBe('scheduled');
    expect((await bookings.findById(confirmed.id))!.status).toBe('cancelled');
    expect((await bookings.findById(pending.id))!.status).toBe('expired');
    for (const { c } of [a, b])
      expect(await cabins.findById(c.id).lean()).toMatchObject({
        bookedSeats: 0,
        heldSeats: 0,
      });
    const p = await payments.findOne({ bookingId: confirmed._id });
    const refund = await refunds.findOne({ paymentId: p!._id });
    expect(refund).toMatchObject({
      amountMinorUnits: 2000,
      currency: 'USD',
      status: RefundStatus.PENDING,
    });
    expect(refund!.stripeRefundId).toBeUndefined();
    expect(
      await notifications.countDocuments({
        subjectId: { $in: [confirmed._id, pending._id] },
        type: NotificationType.BOOKING_CANCELLED,
      }),
    ).toBe(2);
    await api('post', `/api/flights/${a.f.id}/cancel`)
      .send({ confirm: true })
      .expect(409);
    expect(await refunds.countDocuments({ paymentId: p!._id })).toBe(1);
    const hidden = await request(ctx.app.getHttpServer())
      .get('/api/flights/search')
      .query({
        departureAirportId: departureId,
        arrivalAirportId: arrivalId,
        departureDate: '2031-01-15',
      })
      .expect(200);
    expect(
      hidden.body.outbound.items.map((x: { _id: string }) => x._id),
    ).not.toContain(a.f.id);
  });

  it('rolls back flight, booking, counters and notifications if payment/refund preconditions fail', async () => {
    const a = await makeFlight();
    const booking = await makeBooking([a], false, 'Rollback', false);
    await api('post', `/api/flights/${a.f.id}/cancel`)
      .send({ confirm: true })
      .expect(409);
    expect((await flights.findById(a.f.id))!.status).toBe('scheduled');
    expect((await bookings.findById(booking.id))!.status).toBe('confirmed');
    expect((await cabins.findById(a.c.id))!.bookedSeats).toBe(1);
    expect(await notifications.countDocuments({ subjectId: booking._id })).toBe(
      0,
    );
  });

  it('serializes simultaneous cancellations without duplicate releases or refunds', async () => {
    const a = await makeFlight();
    const booking = await makeBooking([a]);
    const responses = await Promise.all(
      [1, 2].map(() =>
        api('post', `/api/flights/${a.f.id}/cancel`).send({ confirm: true }),
      ),
    );
    expect(responses.map((r) => r.status).sort((x, y) => x - y)).toEqual([
      200, 409,
    ]);
    expect((await cabins.findById(a.c.id))!.bookedSeats).toBe(0);
    expect(await notifications.countDocuments({ subjectId: booking._id })).toBe(
      1,
    );
  });

  it('keeps capacity valid when a conditional hold races with a seat reduction', async () => {
    for (let i = 0; i < 3; i++) {
      const a = await makeFlight();
      await cabins.updateOne(
        { _id: a.c._id },
        { $set: { totalSeats: 3, bookedSeats: 1, heldSeats: 1 } },
      );
      const [edit, hold] = await Promise.all([
        api('patch', `/api/flights/${a.f.id}/cabins/${a.c.id}`).send({
          totalSeats: 2,
        }),
        cabins
          .updateOne(
            {
              _id: a.c._id,
              $expr: {
                $lt: [{ $add: ['$bookedSeats', '$heldSeats'] }, '$totalSeats'],
              },
            },
            { $inc: { heldSeats: 1 } },
          )
          .exec(),
      ]);
      expect([200, 409]).toContain(edit.status);
      const saved = (await cabins.findById(a.c.id))!;
      expect(saved.bookedSeats + saved.heldSeats).toBeLessThanOrEqual(
        saved.totalSeats,
      );
      expect(hold.modifiedCount).toBe(edit.status === 200 ? 0 : 1);
    }
  });

  it('counts infant passengers as zero seats in views and releases only actual occupied seats', async () => {
    const a = await makeFlight();
    const booking = await makeBooking([a]);
    booking.passengers.push({
      fullName: 'Infant Passenger',
      dateOfBirth: '2030-06-01',
      passportOrIdNumber: 'TEST-INFANT',
      segments: [
        {
          type: 'infant' as (typeof booking.passengers)[0]['segments'][0]['type'],
          fareMinorUnits: 100,
          extraBagWeightsKg: [],
          baggageFeeMinorUnits: 0,
        },
      ],
    });
    booking.totalMinorUnits = 1100;
    await booking.save();
    await payments.updateOne(
      { bookingId: booking._id },
      { $set: { amountMinorUnits: 1100 } },
    );
    const view = await api('get', `/api/flights/${a.f.id}/bookings`).expect(
      200,
    );
    expect(view.body.items[0].seats).toBe(1);
    expect(view.body.items[0].passengers[1].seats).toBe(0);
    await api('post', `/api/flights/${a.f.id}/cancel`)
      .send({ confirm: true })
      .expect(200);
    expect((await cabins.findById(a.c.id))!.bookedSeats).toBe(0);
  });

  it('cancels pending local payment records along with a pending booking hold', async () => {
    const a = await makeFlight();
    const booking = await makeBooking([a], true);
    const payment = await payments.create({
      bookingModel: 'FlightBooking',
      bookingId: booking._id,
      stripePaymentIntentId: `pi_pending_${booking.id}`,
      amountMinorUnits: 1000,
      currency: 'USD',
      status: PaymentStatus.PENDING,
    });
    paymentIds.push(payment._id);
    await api('post', `/api/flights/${a.f.id}/cancel`)
      .send({ confirm: true })
      .expect(200);
    expect((await payments.findById(payment.id))!.status).toBe(
      PaymentStatus.CANCELLED,
    );
    expect((await bookings.findById(booking.id))!.status).toBe(
      BookingStatus.EXPIRED,
    );
  });

  it('paginates confirmed/cancelled bookings, shows remaining seats, and exports safe passenger-only CSV', async () => {
    const a = await makeFlight();
    for (let i = 0; i < 11; i++)
      await makeBooking([a], false, i === 0 ? '=SUM(1,2)' : `Passenger "${i}"`);
    await makeBooking([a], true, 'Pending person must not be listed');
    const response = await api('get', `/api/flights/${a.f.id}/bookings`).expect(
      200,
    );
    expect(response.body).toMatchObject({
      pageSize: 10,
      totalItems: 11,
      totalPages: 2,
    });
    expect(response.body.items).toHaveLength(10);
    expect(response.body.inventory[0]).toMatchObject({
      seatsRemaining: 88,
      bookedSeats: 11,
      heldSeats: 1,
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'TEST-PASSPORT-PRIVATE',
    );
    expect(JSON.stringify(response.body)).not.toContain('2000-01-01');
    expect(JSON.stringify(response.body)).not.toContain('Pending person');
    const page = await api(
      'get',
      `/api/flights/${a.f.id}/bookings?page=2`,
    ).expect(200);
    expect(page.body.items).toHaveLength(1);
    const csv = await api(
      'get',
      `/api/flights/${a.f.id}/passengers/export`,
    ).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.text).toContain(
      '"reference","passenger","cabin","type","seats","status"',
    );
    expect(csv.text).toContain('"\'=SUM(1,2)"');
    expect(csv.text).toContain('Passenger ""1""');
    expect(csv.text).not.toContain('TEST-PASSPORT-PRIVATE');
    expect(csv.text).not.toContain('2000-01-01');
    expect(csv.text.trim().split('\r\n')).toHaveLength(12);
    const empty = await api(
      'get',
      `/api/flights/${a.f.id}/bookings?status=cancelled`,
    ).expect(200);
    expect(empty.body.items).toEqual([]);
    await api(
      'get',
      `/api/flights/${a.f.id}/bookings?status=pending_payment`,
    ).expect(400);
    await api('get', `/api/flights/${a.f.id}/bookings?page=0`).expect(400);
    await api('get', '/api/flights/invalid/bookings').expect(404);
  });
});
