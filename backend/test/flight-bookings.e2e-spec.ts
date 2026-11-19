import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { BookingStatus } from '../src/common/booking-status';
import { FlightBookingLifecycleService } from '../src/flight-bookings/flight-booking-lifecycle.service';
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
import { User, UserRole } from '../src/users/schemas/user.schema';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { airportLocalDateTime } from '../src/flights/local-date-time';
import { flightTestContext } from './support/flight-test-context';

const FARE = 450_000;
const BAG_PRICE = 50_000;
const DAY = 24 * 3_600_000;
// 45 days ahead, on the hour: far enough for the 30-day refund tier.
const DEPARTURE = new Date(
  Math.ceil((Date.now() + 45 * DAY) / 3_600_000) * 3_600_000,
);
const at = (offsetMs: number) => new Date(DEPARTURE.getTime() + offsetMs);
// Born a few months ago: an infant (under 2) on the flight date.
const INFANT_DOB = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10);
const SECOND_INFANT_DOB = new Date(Date.now() - 90 * DAY)
  .toISOString()
  .slice(0, 10);

describe('Flight booking (FLT-19 to FLT-26, e2e)', () => {
  let ctx: Awaited<ReturnType<typeof flightTestContext>>;
  let flights: Model<Flight>;
  let cabins: Model<CabinInventory>;
  let bookings: Model<FlightBooking>;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let notifications: Model<Notification>;
  let lifecycle: FlightBookingLifecycleService;
  const flightIds: Types.ObjectId[] = [];
  const extraUserIds: Types.ObjectId[] = [];
  let cairo: Types.ObjectId;
  let paris: Types.ObjectId;
  let travelerId: Types.ObjectId;
  let otherTraveler: string[];
  let sequence = 0;

  const server = () => ctx.app.getHttpServer();
  const as = (who: string[]) => ({
    post: (path: string) =>
      request(server()).post(`/api/flight-bookings${path}`).set('Cookie', who),
    get: (path: string) =>
      request(server()).get(`/api/flight-bookings${path}`).set('Cookie', who),
  });
  const traveler = () => as(ctx.cookies.traveler);

  async function makeFlight(
    options: {
      from?: Types.ObjectId;
      to?: Types.ObjectId;
      departureAt?: Date;
      hours?: number;
      seats?: number;
      status?: FlightStatus;
    } = {},
  ) {
    const departureAt = options.departureAt ?? DEPARTURE;
    const flight = await flights.create({
      airlineId: ctx.airline._id,
      flightNumber: `BOOK${sequence++}`,
      departureAirportId: options.from ?? cairo,
      arrivalAirportId: options.to ?? paris,
      departureAt,
      arrivalAt: new Date(
        departureAt.getTime() + (options.hours ?? 5) * 3_600_000,
      ),
      departureLocalDate: departureAt.toISOString().slice(0, 10),
      status: options.status ?? FlightStatus.SCHEDULED,
    });
    flightIds.push(flight._id);
    const cabin = await cabins.create({
      flightId: flight._id,
      cabinClass: CabinClass.ECONOMY,
      totalSeats: options.seats ?? 50,
      priceMinorUnits: FARE,
      freeBagCount: 1,
      maxBagWeightKg: 23,
    });
    return { flight, cabin, id: flight._id.toString() };
  }

  const adult = (overrides: Record<string, unknown> = {}) => ({
    type: 'adult',
    fullName: 'Mona Hassan',
    dateOfBirth: '1995-04-12',
    passportOrIdNumber: 'A12345678',
    ...overrides,
  });
  const oneWay = (flightId: string, passengers: object[] = [adult()]) => ({
    outboundFlightId: flightId,
    outboundCabinClass: 'economy',
    passengers,
  });

  /** Confirms a hold the way the payment service will (PAY-01, PAY-02). */
  async function confirm(bookingId: string, withPayment = true) {
    await bookings.updateOne(
      { _id: bookingId },
      { $set: { policyAcceptedAt: new Date() } },
    );
    const booking = await lifecycle.confirmPaidBooking(bookingId);
    if (withPayment)
      await payments.create({
        bookingModel: 'FlightBooking',
        bookingId: booking._id,
        stripePaymentIntentId: `pi_test_${booking.id}`,
        amountMinorUnits: booking.totalMinorUnits,
        currency: booking.currency,
        status: PaymentStatus.SUCCEEDED,
      });
    return booking;
  }

  beforeAll(async () => {
    ctx = await flightTestContext('fbook');
    const model = <T>(name: string) =>
      ctx.app.get<Model<T>>(getModelToken(name));
    flights = model(Flight.name);
    cabins = model(CabinInventory.name);
    bookings = model(FlightBooking.name);
    payments = model(Payment.name);
    refunds = model(Refund.name);
    notifications = model(Notification.name);
    lifecycle = ctx.app.get(FlightBookingLifecycleService);
    await Promise.all([bookings.init(), cabins.init(), flights.init()]);

    const [a, b] = await ctx.airports.create([
      {
        iataCode: 'XBA',
        name: 'Booking Test Cairo',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'XBB',
        name: 'Booking Test Paris',
        cityId: 'paris',
        countryCode: 'FR',
        timeZone: 'Europe/Paris',
      },
    ]);
    ctx.airportIds.push(a._id, b._id);
    cairo = a._id;
    paris = b._id;

    await ctx.airlines.updateOne(
      { _id: ctx.airline._id },
      {
        $set: {
          extraBaggagePolicy: {
            pricePerBagMinorUnits: BAG_PRICE,
            maxExtraBagsPerPassenger: 2,
          },
          cancellationTiers: [
            { daysBeforeDeparture: 30, refundPercentage: 100 },
            { daysBeforeDeparture: 7, refundPercentage: 50 },
          ],
        },
      },
    );

    travelerId = (await ctx.users.findOne({
      role: UserRole.TRAVELER,
      email: /fbook/,
    }))!._id;
    const users = ctx.app.get<Model<User>>(getModelToken(User.name));
    const other = await users.create({
      name: 'Other Traveler',
      email: `other-${new Types.ObjectId().toString()}@fbook.e2e.test`,
      passwordHash: await ctx.app
        .get(PasswordHasherService)
        .hash('TestPassword2026'),
    });
    extraUserIds.push(other._id);
    const login = await request(server())
      .post('/api/auth/login')
      .send({ email: other.email, password: 'TestPassword2026' })
      .expect(200);
    otherTraveler = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0]);
  });

  afterAll(async () => {
    const booked = await bookings.find({
      'segments.flightId': { $in: flightIds },
    });
    const bookingIds = booked.map((b) => b._id);
    const paid = await payments.find({ bookingId: { $in: bookingIds } });
    await refunds.deleteMany({ paymentId: { $in: paid.map((p) => p._id) } });
    await payments.deleteMany({ bookingId: { $in: bookingIds } });
    await notifications.deleteMany({ subjectId: { $in: bookingIds } });
    await bookings.deleteMany({ _id: { $in: bookingIds } });
    await cabins.deleteMany({ flightId: { $in: flightIds } });
    await flights.deleteMany({ _id: { $in: flightIds } });
    await ctx.users.deleteMany({ _id: { $in: extraUserIds } });
    await ctx.cleanUp();
  });

  describe('POST /api/flight-bookings: price summary (FLT-19, FLT-21)', () => {
    it('prices adults, children, infants and extra bags without reserving', async () => {
      const { id, cabin } = await makeFlight();
      const response = await traveler()
        .post('')
        .send(
          oneWay(id, [
            adult({ outboundExtraBagWeightsKg: [20] }),
            adult({
              type: 'child',
              fullName: 'Child',
              dateOfBirth: '2022-01-01',
            }),
            adult({
              type: 'infant',
              fullName: 'Baby',
              dateOfBirth: INFANT_DOB,
            }),
          ]),
        )
        .expect(200);

      expect(response.body).toMatchObject({
        tripType: 'one_way',
        faresMinorUnits: FARE * 2 + FARE / 10,
        baggageFeesMinorUnits: BAG_PRICE,
        totalMinorUnits: FARE * 2 + FARE / 10 + BAG_PRICE,
        currency: 'EGP',
      });
      expect(response.body.segments[0]).toMatchObject({
        seats: 2,
        departureLocalDateTime: airportLocalDateTime(DEPARTURE, 'Africa/Cairo'),
        departureAirport: { iataCode: 'XBA', timeZone: 'Africa/Cairo' },
      });
      expect(response.body.passengers[0].passportOrIdNumber).toBe('•••••5678');
      expect(response.body.cancellationTiers).toHaveLength(2);
      expect((await cabins.findById(cabin._id))!.heldSeats).toBe(0);
    });

    it.each([
      [
        'a type that does not match the date of birth',
        [adult({ dateOfBirth: '2020-01-01' })],
        /entered as adult but is a child/,
      ],
      [
        'no adult',
        [adult({ type: 'child', dateOfBirth: '2022-01-01' })],
        /at least one adult/,
      ],
      [
        'more infants than adults',
        [
          adult(),
          adult({ type: 'infant', dateOfBirth: INFANT_DOB }),
          adult({ type: 'infant', dateOfBirth: SECOND_INFANT_DOB }),
        ],
        /one infant per adult/,
      ],
      [
        'too many extra bags',
        [adult({ outboundExtraBagWeightsKg: [10, 10, 10] })],
        /at most 2 extra bags/,
      ],
      [
        'an extra bag over the weight limit',
        [adult({ outboundExtraBagWeightsKg: [24] })],
        /at most 23 kg/,
      ],
      [
        'return bags on a one-way trip',
        [adult({ returnExtraBagWeightsKg: [10] })],
        /need a return flight/,
      ],
      [
        'a birth date in the future',
        [adult({ type: 'infant', dateOfBirth: '2099-01-01' })],
        /in the future/,
      ],
    ])('returns 400 for %s', async (_case, passengers, message) => {
      const { id } = await makeFlight();
      const response = await traveler()
        .post('')
        .send(oneWay(id, passengers))
        .expect(400);
      expect(String(response.body.message)).toMatch(message);
    });

    it('rejects invalid fields and unknown flights', async () => {
      await traveler()
        .post('')
        .send({
          outboundFlightId: 'x',
          outboundCabinClass: 'deluxe',
          passengers: [],
        })
        .expect(400);
      await traveler()
        .post('')
        .send(oneWay(new Types.ObjectId().toString()))
        .expect(404);
    });

    it('checks the round-trip route and timing (FLT-12)', async () => {
      const out = await makeFlight();
      const wrongRoute = await makeFlight({
        departureAt: at(9 * DAY),
      });
      const tooEarly = await makeFlight({
        from: paris,
        to: cairo,
        departureAt: at(4 * 3_600_000),
      });
      const back = await makeFlight({
        from: paris,
        to: cairo,
        departureAt: at(9 * DAY),
      });
      const roundTrip = (returnFlightId: string) => ({
        ...oneWay(out.id, [adult({ returnExtraBagWeightsKg: [5] })]),
        returnFlightId,
      });

      await traveler().post('').send(roundTrip(wrongRoute.id)).expect(400);
      await traveler().post('').send(roundTrip(tooEarly.id)).expect(400);
      const ok = await traveler().post('').send(roundTrip(back.id)).expect(200);
      expect(ok.body.tripType).toBe('round_trip');
      expect(ok.body.totalMinorUnits).toBe(FARE * 2 + BAG_PRICE);
    });

    it('refuses cancelled flights, inactive airlines and full cabins', async () => {
      const cancelled = await makeFlight({ status: FlightStatus.CANCELLED });
      await traveler().post('').send(oneWay(cancelled.id)).expect(409);

      const full = await makeFlight({ seats: 1 });
      await traveler()
        .post('')
        .send(oneWay(full.id, [adult(), adult({ fullName: 'Second' })]))
        .expect(409);

      const open = await makeFlight();
      await ctx.airlines.updateOne(
        { _id: ctx.airline._id },
        { isActive: false },
      );
      try {
        await traveler().post('').send(oneWay(open.id)).expect(409);
      } finally {
        await ctx.airlines.updateOne(
          { _id: ctx.airline._id },
          { isActive: true },
        );
      }
    });

    it('is only for signed-in travelers', async () => {
      const { id } = await makeFlight();
      await request(server())
        .post('/api/flight-bookings')
        .send(oneWay(id))
        .expect(401);
      await as(ctx.cookies.moderator).post('').send(oneWay(id)).expect(403);
      await as(ctx.cookies.admin).post('').send(oneWay(id)).expect(403);
    });
  });

  describe('POST /api/flight-bookings/hold (FLT-22)', () => {
    it('holds seats for 10 minutes as a Pending Payment booking', async () => {
      const { id, cabin } = await makeFlight();
      const before = Date.now();
      const response = await traveler()
        .post('/hold')
        .send(
          oneWay(id, [
            adult(),
            adult({
              type: 'infant',
              fullName: 'Baby',
              dateOfBirth: INFANT_DOB,
            }),
          ]),
        )
        .expect(201);

      expect(response.body.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(response.body.reference).toBeUndefined();
      const holdMs = new Date(response.body.holdExpiresAt).getTime() - before;
      expect(holdMs).toBeGreaterThan(9.5 * 60_000);
      expect(holdMs).toBeLessThanOrEqual(10 * 60_000 + 5_000);
      // The infant takes no seat.
      expect((await cabins.findById(cabin._id))!.heldSeats).toBe(1);

      const stored = await bookings
        .findById(response.body.id)
        .select('+passengers.passportOrIdNumber');
      expect(stored!.currency).toBe('EGP');
      expect(stored!.passengers[0].passportOrIdNumber).toBe('A12345678');
      expect(stored!.segments[0].cancellationTiers).toHaveLength(2);
    });

    it('never holds more seats than remain under simultaneous requests', async () => {
      const { id, cabin } = await makeFlight({ seats: 3 });
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          traveler()
            .post('/hold')
            .send(oneWay(id, [adult({ fullName: `Racer ${index}` })])),
        ),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
      const after = await cabins.findById(cabin._id);
      expect(after!.heldSeats).toBe(3);
      expect(
        await bookings.countDocuments({ 'segments.flightId': cabin.flightId }),
      ).toBe(3);
    });

    it('expires an unpaid hold and returns its seats', async () => {
      const { id, cabin } = await makeFlight();
      const hold = await traveler().post('/hold').send(oneWay(id)).expect(201);
      await bookings.updateOne(
        { _id: hold.body.id },
        { holdExpiresAt: new Date(Date.now() - 1_000) },
      );

      const cancelled = await traveler().get('?group=cancelled').expect(200);
      expect(
        cancelled.body.items.find(
          (item: { id: string }) => item.id === hold.body.id,
        ).status,
      ).toBe(BookingStatus.EXPIRED);
      expect((await cabins.findById(cabin._id))!.heldSeats).toBe(0);
      // Expiring twice never releases the seats twice.
      await lifecycle.expireDueHolds();
      expect((await cabins.findById(cabin._id))!.heldSeats).toBe(0);
    });
  });

  describe('confirmation, e-ticket and cancellation (FLT-23, FLT-25, FLT-26)', () => {
    it('confirms a paid hold: reference, booked seats and a notification', async () => {
      const { id, cabin } = await makeFlight();
      const hold = await traveler().post('/hold').send(oneWay(id)).expect(201);

      await expect(lifecycle.confirmPaidBooking(hold.body.id)).rejects.toThrow(
        /policies must be accepted/,
      );
      const booking = await confirm(hold.body.id);

      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(booking.reference).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      const after = await cabins.findById(cabin._id);
      expect(after).toMatchObject({ heldSeats: 0, bookedSeats: 1 });
      await expect(
        notifications.countDocuments({
          subjectId: booking._id,
          type: NotificationType.BOOKING_CONFIRMED,
          recipientId: travelerId,
        }),
      ).resolves.toBe(1);
      await expect(lifecycle.confirmPaidBooking(hold.body.id)).rejects.toThrow(
        /waiting for payment/,
      );
    });

    it('refuses to confirm an expired hold', async () => {
      const { id } = await makeFlight();
      const hold = await traveler().post('/hold').send(oneWay(id)).expect(201);
      await bookings.updateOne(
        { _id: hold.body.id },
        {
          holdExpiresAt: new Date(Date.now() - 1_000),
          policyAcceptedAt: new Date(),
        },
      );
      await expect(lifecycle.confirmPaidBooking(hold.body.id)).rejects.toThrow(
        /hold has expired/,
      );
    });

    it('lists, shows and downloads the e-ticket only for the owner', async () => {
      const { id } = await makeFlight();
      const hold = await traveler().post('/hold').send(oneWay(id)).expect(201);
      await traveler().get(`/${hold.body.id}/e-ticket`).expect(409);
      const booking = await confirm(hold.body.id);

      const upcoming = await traveler().get('?group=upcoming').expect(200);
      expect(upcoming.body).toMatchObject({ group: 'upcoming', pageSize: 10 });
      const item = upcoming.body.items.find(
        (entry: { id: string }) => entry.id === hold.body.id,
      );
      expect(item).toMatchObject({
        reference: booking.reference,
        passengerCount: 1,
      });
      expect(JSON.stringify(upcoming.body)).not.toContain('A12345678');

      const details = await traveler().get(`/${hold.body.id}`).expect(200);
      expect(details.body).toMatchObject({
        status: 'confirmed',
        cancellation: {
          allowed: true,
          refundPercentage: 100,
          refundMinorUnits: FARE,
        },
      });

      const ticket = await traveler()
        .get(`/${hold.body.id}/e-ticket`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(ticket.headers['content-type']).toBe('application/pdf');
      expect(ticket.headers['content-disposition']).toContain(
        booking.reference,
      );
      const pdf = (ticket.body as Buffer).toString('latin1');
      expect(pdf.startsWith('%PDF-1.4')).toBe(true);
      expect(pdf).toContain(booking.reference!);
      expect(pdf).not.toContain('A12345678');

      for (const path of [`/${hold.body.id}`, `/${hold.body.id}/e-ticket`]) {
        await as(otherTraveler).get(path).expect(404);
      }
      await as(otherTraveler)
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: true })
        .expect(404);
      await traveler().get('/not-an-id').expect(404);
      await traveler().get('?group=soon').expect(400);
    });

    it('cancels a confirmed round trip with the outbound refund tier', async () => {
      const out = await makeFlight({
        departureAt: new Date(Date.now() + 10 * 24 * 3_600_000),
      });
      const back = await makeFlight({
        from: paris,
        to: cairo,
        departureAt: new Date(Date.now() + 40 * 24 * 3_600_000),
      });
      const hold = await traveler()
        .post('/hold')
        .send({ ...oneWay(out.id), returnFlightId: back.id })
        .expect(201);
      await traveler()
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: true })
        .expect(409);
      const booking = await confirm(hold.body.id);

      await traveler()
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: false })
        .expect(400);
      const response = await traveler()
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: true })
        .expect(200);

      // 10 days left: the 7-day tier (50%) applies to the whole booking.
      expect(response.body).toMatchObject({
        status: 'cancelled',
        refundPercentage: 50,
        refundMinorUnits: FARE,
        currency: 'EGP',
        refundStatus: 'pending',
      });
      for (const leg of [out, back])
        expect(await cabins.findById(leg.cabin._id)).toMatchObject({
          bookedSeats: 0,
          heldSeats: 0,
        });
      const payment = await payments.findOne({ bookingId: booking._id });
      await expect(
        refunds.findOne({ paymentId: payment!._id }),
      ).resolves.toMatchObject({
        amountMinorUnits: FARE,
        status: RefundStatus.PENDING,
      });
      await expect(
        notifications.countDocuments({
          subjectId: booking._id,
          type: NotificationType.BOOKING_CANCELLED,
        }),
      ).resolves.toBe(1);
      await traveler()
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: true })
        .expect(409);
    });

    it('cancels without a refund when no tier applies', async () => {
      const { id } = await makeFlight({
        departureAt: new Date(Date.now() + 2 * 24 * 3_600_000),
      });
      const hold = await traveler().post('/hold').send(oneWay(id)).expect(201);
      await confirm(hold.body.id, false);

      const response = await traveler()
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: true })
        .expect(200);
      expect(response.body).toMatchObject({
        refundPercentage: 0,
        refundMinorUnits: 0,
        refundStatus: 'none',
      });
    });

    it('blocks cancellation after departure and completes finished trips', async () => {
      const { id, flight } = await makeFlight({
        departureAt: new Date(Date.now() + 24 * 3_600_000),
      });
      const hold = await traveler().post('/hold').send(oneWay(id)).expect(201);
      await confirm(hold.body.id);
      // The flight left and landed.
      await flights.updateOne(
        { _id: flight._id },
        {
          departureAt: new Date(Date.now() - 6 * 3_600_000),
          arrivalAt: new Date(Date.now() - 3_600_000),
          status: FlightStatus.DEPARTED,
        },
      );

      await traveler()
        .post(`/${hold.body.id}/cancel`)
        .send({ confirm: true })
        .expect(409);
      expect(await lifecycle.completeFinished()).toBeGreaterThanOrEqual(1);
      const past = await traveler().get('?group=past').expect(200);
      expect(
        past.body.items.find((item: { id: string }) => item.id === hold.body.id)
          .status,
      ).toBe(BookingStatus.COMPLETED);
      await traveler().get(`/${hold.body.id}/e-ticket`).expect(200);
    });
  });
});
