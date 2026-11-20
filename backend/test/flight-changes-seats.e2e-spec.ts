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
import { FlightChangesService } from '../src/flight-bookings/flight-changes.service';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { FlightChange } from '../src/flight-bookings/schemas/flight-change.schema';
import { SeatAssignment } from '../src/flight-bookings/schemas/seat-assignment.schema';
import {
  CabinClass,
  CabinInventory,
} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../src/flights/schemas/flight.schema';
import { Notification } from '../src/notifications/schemas/notification.schema';
import { RefundsService } from '../src/payments/refunds.service';
import { Payment } from '../src/payments/schemas/payment.schema';
import { Refund } from '../src/payments/schemas/refund.schema';
import {
  IntentState,
  RefundState,
  StripeGateway,
} from '../src/payments/stripe-gateway';
import { User, UserRole } from '../src/users/schemas/user.schema';

const TAG = 'change.e2e.test';
const PASSWORD = 'TestPassword2026';
const DAY = 86_400_000;

/** Stripe test mode without the network (see payments.e2e-spec.ts). */
class FakeStripe {
  intents = new Map<string, IntentState>();
  refunds = new Map<string, RefundState>();
  refundCalls: { paymentIntentId: string; amountMinorUnits: number }[] = [];
  private byKey = new Map<string, string>();
  private refundsByKey = new Map<string, RefundState>();
  private count = 0;

  isTestMode() {
    return true;
  }
  async createIntent(input: {
    amountMinorUnits: number;
    currency: string;
    idempotencyKey?: string;
  }) {
    const existing =
      input.idempotencyKey && this.byKey.get(input.idempotencyKey);
    if (existing) return { ...this.intents.get(existing)! };
    const id = `pi_change_${++this.count}`;
    const intent: IntentState = {
      id,
      status: 'requires_payment_method',
      amount: input.amountMinorUnits,
      currency: input.currency.toLowerCase(),
      clientSecret: `${id}_secret_test`,
    };
    this.intents.set(id, intent);
    if (input.idempotencyKey) this.byKey.set(input.idempotencyKey, id);
    return { ...intent };
  }
  async retrieveIntent(id: string) {
    return { ...this.intents.get(id)! };
  }
  async confirmWithTestMethod(id: string) {
    const intent = this.intents.get(id)!;
    intent.status = 'succeeded';
    return { ...intent };
  }
  async cancelIntent(id: string) {
    const intent = this.intents.get(id)!;
    if (intent.status !== 'succeeded') intent.status = 'canceled';
    return { ...intent };
  }
  async createRefund(input: {
    paymentIntentId: string;
    amountMinorUnits: number;
    idempotencyKey: string;
  }) {
    const existing = this.refundsByKey.get(input.idempotencyKey);
    if (existing) return { ...existing };
    this.refundCalls.push(input);
    const refund = { id: `re_change_${++this.count}`, status: 'succeeded' };
    this.refunds.set(refund.id, refund);
    this.refundsByKey.set(input.idempotencyKey, refund);
    return { ...refund };
  }
  async retrieveRefund(id: string) {
    return { ...this.refunds.get(id)! };
  }
}

describe('Flight changes and seat selection (FLT-27, FLT-28, e2e)', () => {
  let app: INestApplication<App>;
  const stripe = new FakeStripe();
  const cookies: Record<string, string[]> = {};
  const flight: Record<string, string> = {};
  let sequence = 0;
  let models: {
    users: Model<User>;
    airlines: Model<Airline>;
    airports: Model<Airport>;
    flights: Model<Flight>;
    cabins: Model<CabinInventory>;
    bookings: Model<FlightBooking>;
    changes: Model<FlightChange>;
    seats: Model<SeatAssignment>;
    payments: Model<Payment>;
    refunds: Model<Refund>;
    notifications: Model<Notification>;
  };

  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    who?: string,
  ) => {
    const req = request(app.getHttpServer())[method](`/api${path}`);
    return who ? req.set('Cookie', cookies[who]) : req;
  };
  const cabin = (name: string) =>
    models.cabins
      .findOne({ flightId: new Types.ObjectId(flight[name]) })
      .lean()
      .exec();

  async function addUser(name: string) {
    const user = await models.users.create({
      name,
      email: `${name}@${TAG}`,
      role: UserRole.TRAVELER,
      passwordHash: await app.get(PasswordHasherService).hash(PASSWORD),
    });
    const login = await call('post', '/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    cookies[name] = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0]);
  }

  /** Holds, accepts and pays a booking on F1, so it is confirmed. */
  async function confirmedBooking(who = 'traveler', on = 'F1', count = 1) {
    const hold = await call('post', '/flight-bookings/hold', who)
      .send({
        outboundFlightId: flight[on],
        outboundCabinClass: 'economy',
        passengers: Array.from({ length: count }, () => ({
          type: 'adult',
          fullName: `Passenger ${sequence++}`,
          dateOfBirth: '1990-01-01',
          passportOrIdNumber: 'A1234567',
        })),
      })
      .expect(201);
    const id = hold.body.id as string;
    await call('post', `/bookings/flight/${id}/accept-policies`, who)
      .send({ accept: true })
      .expect(200);
    await call('post', '/payments', who)
      .send({
        bookingType: 'flight',
        bookingId: id,
        testPaymentMethod: 'pm_card_visa',
      })
      .expect(201);
    return id;
  }

  async function cleanUp() {
    const users = (
      await models.users.find({ email: new RegExp(`@${TAG}$`) })
    ).map((u) => u._id);
    const bookings = (
      await models.bookings.find({ userId: { $in: users } })
    ).map((b) => b._id);
    const changes = (
      await models.changes.find({ bookingId: { $in: bookings } })
    ).map((c) => c._id);
    const payments = (
      await models.payments.find({
        bookingId: { $in: [...bookings, ...changes] },
      })
    ).map((p) => p._id);
    await models.refunds.deleteMany({ paymentId: { $in: payments } });
    await models.payments.deleteMany({ _id: { $in: payments } });
    await models.changes.deleteMany({ _id: { $in: changes } });
    await models.seats.deleteMany({ bookingId: { $in: bookings } });
    await models.notifications.deleteMany({ recipientId: { $in: users } });
    await models.bookings.deleteMany({ _id: { $in: bookings } });
    const airline = await models.airlines.findOne({ code: 'CHGE2E' });
    if (airline) {
      const flights = (
        await models.flights.find({ airlineId: airline._id })
      ).map((f) => f._id);
      await models.cabins.deleteMany({ flightId: { $in: flights } });
      await models.flights.deleteMany({ _id: { $in: flights } });
      await models.airlines.deleteOne({ _id: airline._id });
    }
    await models.airports.deleteMany({ iataCode: { $in: ['XCA', 'XCB'] } });
    await app
      .get<Model<Session>>(getModelToken(Session.name))
      .deleteMany({ userId: { $in: users } });
    await models.users.deleteMany({ _id: { $in: users } });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeGateway)
      .useValue(stripe)
      .compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useLogger(false);
    configureApp(app);
    await app.init();
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    models = {
      users: model(User.name),
      airlines: model(Airline.name),
      airports: model(Airport.name),
      flights: model(Flight.name),
      cabins: model(CabinInventory.name),
      bookings: model(FlightBooking.name),
      changes: model(FlightChange.name),
      seats: model(SeatAssignment.name),
      payments: model(Payment.name),
      refunds: model(Refund.name),
      notifications: model(Notification.name),
    };
    await Promise.all(Object.values(models).map((m) => m.init()));
    await cleanUp();
    await addUser('traveler');
    await addUser('other');

    const airline = await models.airlines.create({
      name: 'Change Test Air',
      code: 'CHGE2E',
      extraBaggagePolicy: {
        pricePerBagMinorUnits: 50_000,
        maxExtraBagsPerPassenger: 1,
      },
      cancellationTiers: [{ daysBeforeDeparture: 7, refundPercentage: 100 }],
    });
    const [a, b] = await models.airports.create([
      {
        iataCode: 'XCA',
        name: 'Change A',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'XCB',
        name: 'Change B',
        cityId: 'paris',
        countryCode: 'FR',
        timeZone: 'Europe/Paris',
      },
    ]);
    const base = Math.ceil((Date.now() + 40 * DAY) / 3_600_000) * 3_600_000;
    const make = async (
      name: string,
      days: number,
      price: number,
      seats = 30,
      reverse = false,
    ) => {
      const departureAt = new Date(base + days * DAY);
      const created = await models.flights.create({
        airlineId: airline._id,
        flightNumber: `CH${name}`,
        departureAirportId: reverse ? b._id : a._id,
        arrivalAirportId: reverse ? a._id : b._id,
        departureAt,
        arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
        departureLocalDate: departureAt.toISOString().slice(0, 10),
        status: FlightStatus.SCHEDULED,
      });
      await models.cabins.create({
        flightId: created._id,
        cabinClass: CabinClass.ECONOMY,
        totalSeats: seats,
        priceMinorUnits: price,
        freeBagCount: 1,
        maxBagWeightKg: 23,
      });
      flight[name] = created._id.toString();
    };
    await make('F1', 0, 300_000);
    await make('F2', 1, 400_000);
    await make('F3', 2, 250_000);
    await make('FULL', 3, 300_000, 1);
    await make('BACK', 5, 300_000, 30, true);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('seat selection (FLT-28)', () => {
    it('shows a public seat map of the cabin', async () => {
      const map = await call(
        'get',
        `/flights/${flight.F1}/seats?cabinClass=economy`,
      ).expect(200);
      expect(map.body).toMatchObject({
        flightNumber: 'CHF1',
        cabinClass: 'economy',
        availableCount: 30,
      });
      expect(map.body.seats[0]).toEqual({ seat: '20A', available: true });
      expect(map.body.seats.at(-1).seat).toBe('24F');
      await call('get', `/flights/${flight.F1}/seats`).expect(400);
      await call(
        'get',
        `/flights/${flight.F1}/seats?cabinClass=business`,
      ).expect(404);
    });

    it('lets each seat go to one passenger only', async () => {
      const mine = await confirmedBooking();
      const chosen = await call(
        'patch',
        `/flight-bookings/${mine}/seat`,
        'traveler',
      )
        .send({ leg: 'outbound', passenger: 1, seat: '20a' })
        .expect(200);
      expect(chosen.body.passengers[0].segments[0].seat).toBe('20A');

      const theirs = await confirmedBooking('other');
      await call('patch', `/flight-bookings/${theirs}/seat`, 'other')
        .send({ leg: 'outbound', passenger: 1, seat: '20A' })
        .expect(409);
      // Not their booking, a seat outside the cabin, a missing passenger.
      await call('patch', `/flight-bookings/${mine}/seat`, 'other')
        .send({ leg: 'outbound', passenger: 1, seat: '20B' })
        .expect(404);
      await call('patch', `/flight-bookings/${mine}/seat`, 'traveler')
        .send({ leg: 'outbound', passenger: 1, seat: '99A' })
        .expect(400);
      await call('patch', `/flight-bookings/${mine}/seat`, 'traveler')
        .send({ leg: 'outbound', passenger: 2, seat: '20B' })
        .expect(400);
      await call('patch', `/flight-bookings/${mine}/seat`, 'traveler')
        .send({ leg: 'return', passenger: 1, seat: '20B' })
        .expect(400);

      // Moving frees the old seat.
      await call('patch', `/flight-bookings/${mine}/seat`, 'traveler')
        .send({ leg: 'outbound', passenger: 1, seat: '20B' })
        .expect(200);
      await call('patch', `/flight-bookings/${theirs}/seat`, 'other')
        .send({ leg: 'outbound', passenger: 1, seat: '20A' })
        .expect(200);
      const map = await call(
        'get',
        `/flights/${flight.F1}/seats?cabinClass=economy`,
      ).expect(200);
      const free = new Map(
        (map.body.seats as { seat: string; available: boolean }[]).map((s) => [
          s.seat,
          s.available,
        ]),
      );
      expect(free.get('20A')).toBe(false);
      expect(free.get('20B')).toBe(false);
      expect(free.get('20C')).toBe(true);
    });

    it('gives a seat to exactly one of two simultaneous requests', async () => {
      const one = await confirmedBooking('traveler');
      const two = await confirmedBooking('other');
      const results = await Promise.all([
        call('patch', `/flight-bookings/${one}/seat`, 'traveler').send({
          leg: 'outbound',
          passenger: 1,
          seat: '22D',
        }),
        call('patch', `/flight-bookings/${two}/seat`, 'other').send({
          leg: 'outbound',
          passenger: 1,
          seat: '22D',
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await models.seats.countDocuments({
          cabinInventoryId: (await cabin('F1'))!._id,
          seat: '22D',
        }),
      ).toBe(1);
    });

    it('frees the seats of a cancelled booking and prints seats on the e-ticket', async () => {
      const id = await confirmedBooking();
      await call('patch', `/flight-bookings/${id}/seat`, 'traveler')
        .send({ leg: 'outbound', passenger: 1, seat: '23A' })
        .expect(200);
      const ticket = await call(
        'get',
        `/flight-bookings/${id}/e-ticket`,
        'traveler',
      )
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((ticket.body as Buffer).toString('latin1')).toContain('23A');
      await call('post', `/flight-bookings/${id}/cancel`, 'traveler')
        .send({ confirm: true })
        .expect(200);
      await call('patch', `/flight-bookings/${id}/seat`, 'traveler')
        .send({ leg: 'outbound', passenger: 1, seat: '23B' })
        .expect(409);
      const other = await confirmedBooking('other');
      await call('patch', `/flight-bookings/${other}/seat`, 'other')
        .send({ leg: 'outbound', passenger: 1, seat: '23A' })
        .expect(200);
    });
  });

  describe('changing a flight (FLT-27)', () => {
    let bookingId: string;
    let originalIntent: string;

    it('quotes a more expensive flight without changing anything', async () => {
      bookingId = await confirmedBooking();
      originalIntent = (await models.payments
        .findOne({ bookingId: new Types.ObjectId(bookingId) })
        .lean())!.stripePaymentIntentId;
      const before = await cabin('F2');
      const quote = await call(
        'patch',
        `/flight-bookings/${bookingId}/change-flight`,
        'traveler',
      )
        .send({ leg: 'outbound', newFlightId: flight.F2, previewOnly: true })
        .expect(200);
      expect(quote.body).toMatchObject({
        preview: true,
        status: 'quote',
        oldSegmentTotalMinorUnits: 300_000,
        newSegmentTotalMinorUnits: 400_000,
        fareDifferenceMinorUnits: 100_000,
        amountDueMinorUnits: 100_000,
        refundMinorUnits: 0,
      });
      const after = await cabin('F2');
      expect(after!.heldSeats).toBe(before!.heldSeats);
      expect(after!.bookedSeats).toBe(before!.bookedSeats);
    });

    it('refuses other routes, the same flight, full flights and strangers', async () => {
      const send = (body: object, who = 'traveler') =>
        call('patch', `/flight-bookings/${bookingId}/change-flight`, who).send(
          body,
        );
      await send({ leg: 'outbound', newFlightId: flight.BACK }).expect(400);
      await send({ leg: 'outbound', newFlightId: flight.F1 }).expect(400);
      await send({ leg: 'return', newFlightId: flight.F2 }).expect(400);
      await send({ leg: 'outbound', newFlightId: flight.F2 }, 'other').expect(
        404,
      );
      await confirmedBooking('other', 'FULL');
      await send({ leg: 'outbound', newFlightId: flight.FULL }).expect(409);
    });

    it('holds the new seat until the fare difference is paid', async () => {
      const f1 = await cabin('F1');
      const change = await call(
        'patch',
        `/flight-bookings/${bookingId}/change-flight`,
        'traveler',
      )
        .send({ leg: 'outbound', newFlightId: flight.F2 })
        .expect(200);
      expect(change.body).toMatchObject({
        preview: false,
        status: 'pending_payment',
        amountDueMinorUnits: 100_000,
      });
      const changeId = change.body.changeId as string;
      expect((await cabin('F2'))!.heldSeats).toBe(1);
      // Still on the old flight until paid; one pending change at a time.
      expect(change.body.booking.segments[0].flightId).toBe(flight.F1);
      await call(
        'patch',
        `/flight-bookings/${bookingId}/change-flight`,
        'traveler',
      )
        .send({ leg: 'outbound', newFlightId: flight.F3 })
        .expect(409);
      await call(
        'get',
        `/bookings/flight_change/${changeId}/policies`,
        'traveler',
      ).expect(400);
      await call('post', '/payments', 'other')
        .send({
          bookingType: 'flight_change',
          bookingId: changeId,
          testPaymentMethod: 'pm_card_visa',
        })
        .expect(404);

      const paid = await call('post', '/payments', 'traveler')
        .send({
          bookingType: 'flight_change',
          bookingId: changeId,
          testPaymentMethod: 'pm_card_visa',
        })
        .expect(201);
      expect(paid.body).toMatchObject({
        bookingType: 'flight_change',
        amountMinorUnits: 100_000,
        status: 'succeeded',
        bookingStatus: 'confirmed',
      });
      const details = await call(
        'get',
        `/flight-bookings/${bookingId}`,
        'traveler',
      ).expect(200);
      expect(details.body.segments[0].flightId).toBe(flight.F2);
      expect(details.body.totalMinorUnits).toBe(400_000);
      expect((await cabin('F2'))!).toMatchObject({
        heldSeats: 0,
        bookedSeats: 1,
      });
      expect((await cabin('F1'))!.bookedSeats).toBe(f1!.bookedSeats - 1);
    });

    it('changes to a cheaper flight at once and refunds the difference', async () => {
      const calls = stripe.refundCalls.length;
      const change = await call(
        'patch',
        `/flight-bookings/${bookingId}/change-flight`,
        'traveler',
      )
        .send({ leg: 'outbound', newFlightId: flight.F3 })
        .expect(200);
      expect(change.body).toMatchObject({
        status: 'confirmed',
        fareDifferenceMinorUnits: -150_000,
        amountDueMinorUnits: 0,
        refundMinorUnits: 150_000,
      });
      expect(change.body.booking.segments[0].flightId).toBe(flight.F3);
      expect(change.body.booking.totalMinorUnits).toBe(250_000);
      expect(stripe.refundCalls.slice(calls)).toEqual([
        expect.objectContaining({
          paymentIntentId: originalIntent,
          amountMinorUnits: 150_000,
        }),
      ]);
      const stored = await models.changes.findById(change.body.changeId).lean();
      expect(stored!.refundStatus).toBe('refunded');
      expect((await cabin('F2'))!.bookedSeats).toBe(0);
      expect((await cabin('F3'))!.bookedSeats).toBe(1);
    });

    it('splits the cancellation refund over the payments that are left', async () => {
      // Send refunds left over from earlier tests first.
      await app.get(RefundsService).dispatchPending();
      const calls = stripe.refundCalls.length;
      const cancelled = await call(
        'post',
        `/flight-bookings/${bookingId}/cancel`,
        'traveler',
      )
        .send({ confirm: true })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        refundPercentage: 100,
        refundMinorUnits: 250_000,
      });
      await app.get(RefundsService).dispatchPending();
      // 100,000 from the change payment, 150,000 left on the original.
      expect(
        stripe.refundCalls
          .slice(calls)
          .map((c) => c.amountMinorUnits)
          .sort((x, y) => x - y),
      ).toEqual([100_000, 150_000]);
      const details = await call(
        'get',
        `/flight-bookings/${bookingId}`,
        'traveler',
      ).expect(200);
      expect(details.body.refund).toMatchObject({
        amountMinorUnits: 250_000,
        status: 'refunded',
      });
      expect((await cabin('F3'))!.bookedSeats).toBe(0);
    });

    it('releases the held seats when the difference is not paid in time', async () => {
      const id = await confirmedBooking();
      const change = await call(
        'patch',
        `/flight-bookings/${id}/change-flight`,
        'traveler',
      )
        .send({ leg: 'outbound', newFlightId: flight.F2 })
        .expect(200);
      expect((await cabin('F2'))!.heldSeats).toBe(1);
      await app
        .get(FlightChangesService)
        .sweep(new Date(Date.now() + 11 * 60_000));
      expect(
        (await models.changes.findById(change.body.changeId).lean())!.status,
      ).toBe('expired');
      expect((await cabin('F2'))!.heldSeats).toBe(0);
      await call('post', '/payments', 'traveler')
        .send({
          bookingType: 'flight_change',
          bookingId: change.body.changeId,
          testPaymentMethod: 'pm_card_visa',
        })
        .expect(409);
      const details = await call('get', `/flight-bookings/${id}`, 'traveler');
      expect(details.body.segments[0].flightId).toBe(flight.F1);
    });
  });
});
