import { FlightManagementService } from '../src/flights/flight-management.service';
import { AccountDeactivationService } from '../src/users/account-deactivation.service';
import { UserStatus } from '../src/users/schemas/user.schema';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import { Airline } from '../src/airlines/schemas/airline.schema';
import { Airport } from '../src/airports/schemas/airport.schema';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { Session } from '../src/auth/schemas/session.schema';
import { BookingStatus } from '../src/common/booking-status';
import { FlightBookingLifecycleService } from '../src/flight-bookings/flight-booking-lifecycle.service';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import {
  CabinClass,
  CabinInventory,
} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightStatus } from '../src/flights/schemas/flight.schema';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { addDays, hotelNow } from '../src/hotels/hotel-dates';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import {
  Notification,
  NotificationType,
} from '../src/notifications/schemas/notification.schema';
import { RefundsService } from '../src/payments/refunds.service';
import { PaymentsService } from '../src/payments/payments.service';
import { Payment, PaymentStatus } from '../src/payments/schemas/payment.schema';
import { Refund, RefundStatus } from '../src/payments/schemas/refund.schema';
import {
  IntentState,
  RefundState,
  StripeGateway,
} from '../src/payments/stripe-gateway';
import { User, UserRole } from '../src/users/schemas/user.schema';

const TAG = 'pay.e2e.test';
const PASSWORD = 'TestPassword2026';
const WEBHOOK_SECRET = 'whsec_e2e_test_secret';
const DAY = 86_400_000;

/**
 * Behaves like Stripe in test mode, without the network: test card tokens,
 * declines, cancellation and refunds. Webhook signatures use Stripe's real
 * signing code.
 */
class FakeStripe {
  intents = new Map<string, IntentState>();
  refunds = new Map<string, RefundState>();
  refundCalls: { paymentIntentId: string; amountMinorUnits: number }[] = [];
  private refundsByKey = new Map<string, RefundState>();
  private count = 0;
  private intentsByKey = new Map<string, string>();
  cancelCalls: string[] = [];

  isTestMode() {
    return true;
  }
  async createIntent(input: {
    amountMinorUnits: number;
    currency: string;
    idempotencyKey?: string;
  }) {
    const existingId =
      input.idempotencyKey && this.intentsByKey.get(input.idempotencyKey);
    if (existingId) return { ...this.intents.get(existingId)! };
    const id = `pi_fake_${++this.count}`;
    const intent: IntentState = {
      id,
      status: 'requires_payment_method',
      amount: input.amountMinorUnits,
      currency: input.currency.toLowerCase(),
      clientSecret: `${id}_secret_test`,
    };
    this.intents.set(id, intent);
    if (input.idempotencyKey) this.intentsByKey.set(input.idempotencyKey, id);
    return { ...intent };
  }
  async retrieveIntent(id: string) {
    return { ...this.intents.get(id)! };
  }
  async confirmWithTestMethod(id: string, method: string) {
    const intent = this.intents.get(id)!;
    if (method === 'pm_card_chargeDeclined') {
      intent.status = 'requires_payment_method';
      intent.failureMessage = 'Your card was declined.';
    } else {
      intent.status = 'succeeded';
      intent.failureMessage = undefined;
    }
    return { ...intent };
  }
  async cancelIntent(id: string) {
    this.cancelCalls.push(id);
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
    const refund = { id: `re_fake_${++this.count}`, status: 'succeeded' };
    this.refunds.set(refund.id, refund);
    this.refundsByKey.set(input.idempotencyKey, refund);
    return { ...refund };
  }
  async retrieveRefund(id: string) {
    return { ...this.refunds.get(id)! };
  }
  constructWebhookEvent(rawBody: Buffer, signature: string) {
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
    } catch {
      throw new (require('@nestjs/common').BadRequestException)(
        'Invalid Stripe signature.',
      );
    }
  }
}

describe('Payments and refunds (PAY-01 to PAY-04, e2e)', () => {
  let app: INestApplication<App>;
  const stripe = new FakeStripe();
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, Types.ObjectId> = {};
  let models: {
    users: Model<User>;
    airlines: Model<Airline>;
    airports: Model<Airport>;
    flights: Model<Flight>;
    cabins: Model<CabinInventory>;
    flightBookings: Model<FlightBooking>;
    hotels: Model<Hotel>;
    rooms: Model<Room>;
    availability: Model<RoomAvailability>;
    hotelBookings: Model<HotelBooking>;
    payments: Model<Payment>;
    refunds: Model<Refund>;
    notifications: Model<Notification>;
  };
  let flightId: string;
  let hotelId: string;
  let roomIds: string[] = [];
  let payments: PaymentsService;
  let sequence = 0;
  const today = hotelNow('Africa/Cairo').date;

  const server = () => app.getHttpServer();
  const call = (method: 'get' | 'post', path: string, who?: string) => {
    const req = request(server())[method](`/api${path}`);
    return who ? req.set('Cookie', cookies[who]) : req;
  };

  async function addUser(name: string, role: UserRole) {
    const user = await models.users.create({
      name,
      email: `${name}@${TAG}`,
      role,
      assignedProviderId:
        role === UserRole.AIRLINE_MODERATOR ? new Types.ObjectId() : undefined,
      passwordHash: await app.get(PasswordHasherService).hash(PASSWORD),
    });
    ids[name] = user._id;
    const login = await call('post', '/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    cookies[name] = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0]);
  }

  const holdFlight = async (who = 'traveler') =>
    (
      await call('post', '/flight-bookings/hold', who)
        .send({
          outboundFlightId: flightId,
          outboundCabinClass: 'economy',
          passengers: [
            {
              type: 'adult',
              fullName: `Passenger ${sequence++}`,
              dateOfBirth: '1990-01-01',
              passportOrIdNumber: 'A1234567',
            },
          ],
        })
        .expect(201)
    ).body.id as string;

  const holdHotel = async (offset: number, who = 'traveler') =>
    (
      await call('post', '/hotel-bookings', who)
        .send({
          hotelId,
          checkInDate: addDays(today, offset),
          checkOutDate: addDays(today, offset + 2),
          rooms: [{ roomId: roomIds[0], adults: 1 }],
        })
        .expect(201)
    ).body.id as string;

  const accept = (type: string, id: string, who = 'traveler') =>
    call('post', `/bookings/${type}/${id}/accept-policies`, who)
      .send({ accept: true })
      .expect(200);

  const pay = (
    type: string,
    bookingId: string,
    extra: object = {},
    who = 'traveler',
  ) =>
    call('post', '/payments', who).send({
      bookingType: type,
      bookingId,
      ...extra,
    });

  /** Sends a correctly signed Stripe event to the webhook. */
  function webhook(type: string, object: object, secret = WEBHOOK_SECRET) {
    const payload = JSON.stringify({
      id: `evt_${++sequence}`,
      object: 'event',
      type,
      data: { object },
    });
    return request(server())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        Stripe.webhooks.generateTestHeaderString({ payload, secret }),
      )
      .send(payload);
  }

  async function cleanUp() {
    const travelerIds = (
      await models.users.find({
        email: new RegExp(`@${TAG.replace(/\./g, '\\.')}$`),
      })
    ).map((u) => u._id);
    const bookingIds = [
      ...(await models.flightBookings.find({ userId: { $in: travelerIds } })),
      ...(await models.hotelBookings.find({ userId: { $in: travelerIds } })),
    ].map((b) => b._id);
    const paymentIds = (
      await models.payments.find({ bookingId: { $in: bookingIds } })
    ).map((p) => p._id);
    await models.refunds.deleteMany({ paymentId: { $in: paymentIds } });
    await models.payments.deleteMany({ _id: { $in: paymentIds } });
    await models.notifications.deleteMany({
      recipientId: { $in: travelerIds },
    });
    await models.flightBookings.deleteMany({ _id: { $in: bookingIds } });
    await models.hotelBookings.deleteMany({ _id: { $in: bookingIds } });
    const airline = await models.airlines.findOne({ code: 'PAYE2E' });
    if (airline) {
      const flightIds = (
        await models.flights.find({ airlineId: airline._id })
      ).map((f) => f._id);
      await models.cabins.deleteMany({ flightId: { $in: flightIds } });
      await models.flights.deleteMany({ _id: { $in: flightIds } });
      await models.airlines.deleteOne({ _id: airline._id });
    }
    await models.airports.deleteMany({ iataCode: { $in: ['XPA', 'XPB'] } });
    const hotel = await models.hotels.findOne({ name: 'Payment Test Hotel' });
    if (hotel) {
      const rooms = (await models.rooms.find({ hotelId: hotel._id })).map(
        (r) => r._id,
      );
      await models.availability.deleteMany({ roomId: { $in: rooms } });
      await models.rooms.deleteMany({ _id: { $in: rooms } });
      await models.hotels.deleteOne({ _id: hotel._id });
    }
    await app
      .get<Model<Session>>(getModelToken(Session.name))
      .deleteMany({ userId: { $in: travelerIds } });
    await models.users.deleteMany({ _id: { $in: travelerIds } });
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
      flightBookings: model(FlightBooking.name),
      hotels: model(Hotel.name),
      rooms: model(Room.name),
      availability: model(RoomAvailability.name),
      hotelBookings: model(HotelBooking.name),
      payments: model(Payment.name),
      refunds: model(Refund.name),
      notifications: model(Notification.name),
    };
    payments = app.get(PaymentsService);
    await Promise.all(Object.values(models).map((m) => m.init()));
    await cleanUp();

    await addUser('traveler', UserRole.TRAVELER);
    await addUser('other', UserRole.TRAVELER);
    await addUser('moderator', UserRole.AIRLINE_MODERATOR);

    const airline = await models.airlines.create({
      name: 'Payment Test Air',
      code: 'PAYE2E',
      extraBaggagePolicy: {
        pricePerBagMinorUnits: 50_000,
        maxExtraBagsPerPassenger: 1,
      },
      cancellationTiers: [{ daysBeforeDeparture: 7, refundPercentage: 100 }],
    });
    const [a, b] = await models.airports.create([
      {
        iataCode: 'XPA',
        name: 'Pay A',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'XPB',
        name: 'Pay B',
        cityId: 'paris',
        countryCode: 'FR',
        timeZone: 'Europe/Paris',
      },
    ]);
    const departureAt = new Date(
      Math.ceil((Date.now() + 40 * DAY) / 3_600_000) * 3_600_000,
    );
    const flight = await models.flights.create({
      airlineId: airline._id,
      flightNumber: 'PAY1',
      departureAirportId: a._id,
      arrivalAirportId: b._id,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
      departureLocalDate: departureAt.toISOString().slice(0, 10),
      status: FlightStatus.SCHEDULED,
    });
    flightId = flight._id.toString();
    await models.cabins.create({
      flightId: flight._id,
      cabinClass: CabinClass.ECONOMY,
      totalSeats: 50,
      priceMinorUnits: 300_000,
      freeBagCount: 1,
      maxBagWeightKg: 23,
    });

    const hotel = await models.hotels.create({
      name: 'Payment Test Hotel',
      address: 'x',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
      description: 'x',
      starClass: 3,
      policy: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBeforeCheckIn: 3, refundPercentage: 50 }],
      },
    });
    hotelId = hotel._id.toString();
    for (const label of ['P1', 'P2']) {
      const room = await models.rooms.create({
        hotelId: hotel._id,
        label,
        roomType: 'Double',
        bedCount: 1,
        maxOccupancy: 2,
        nightlyPriceMinorUnits: 100_000,
      });
      await models.availability.create({
        roomId: room._id,
        bookableRanges: [{ fromDate: today, untilDate: addDays(today, 200) }],
      });
      roomIds.push(room._id.toString());
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('policies (PAY-02)', () => {
    it('shows airline and hotel policies and stores acceptance', async () => {
      const flightBooking = await holdFlight();
      const policies = await call(
        'get',
        `/bookings/flight/${flightBooking}/policies`,
        'traveler',
      ).expect(200);
      expect(policies.body.policies[0]).toMatchObject({
        freeBaggage: { bags: 1, maxWeightKgPerBag: 23 },
        extraBaggage: {
          pricePerBagMinorUnits: 50_000,
          maxExtraBagsPerPassenger: 1,
        },
        cancellationTiers: [{ daysBeforeDeparture: 7, refundPercentage: 100 }],
      });
      expect(policies.body.policyAcceptedAt).toBeUndefined();

      await pay('flight', flightBooking).expect(409);
      await call(
        'post',
        `/bookings/flight/${flightBooking}/accept-policies`,
        'traveler',
      )
        .send({ accept: false })
        .expect(400);
      const accepted = await accept('flight', flightBooking);
      expect(accepted.body.policyAcceptedAt).toBeDefined();

      const hotelBooking = await holdHotel(40);
      const hotel = await call(
        'get',
        `/bookings/hotel/${hotelBooking}/policies`,
        'traveler',
      ).expect(200);
      expect(hotel.body.policies[0]).toMatchObject({
        checkInTime: '14:00',
        checkOutTime: '12:00',
      });

      await call(
        'get',
        `/bookings/flight/${flightBooking}/policies`,
        'other',
      ).expect(404);
      await call(
        'get',
        `/bookings/train/${flightBooking}/policies`,
        'traveler',
      ).expect(400);
      await call(
        'get',
        `/bookings/flight/${flightBooking}/policies`,
        'moderator',
      ).expect(403);
      await call('get', `/bookings/flight/${flightBooking}/policies`).expect(
        401,
      );
    });
  });

  describe('paying (PAY-01)', () => {
    it('creates a PaymentIntent and confirms the booking only from Stripe’s webhook', async () => {
      const bookingId = await holdFlight();
      await accept('flight', bookingId);
      const created = await pay('flight', bookingId).expect(201);
      expect(created.body).toMatchObject({
        status: 'pending',
        amountMinorUnits: 300_000,
        currency: 'EGP',
        bookingStatus: 'pending_payment',
      });
      expect(created.body.clientSecret).toMatch(/_secret_/);
      const stored = await models.payments.findById(created.body.id).lean();
      expect(Object.keys(stored!).sort()).toEqual(
        [
          '__v',
          '_id',
          'amountMinorUnits',
          'bookingId',
          'bookingModel',
          'createdAt',
          'currency',
          'status',
          'stripePaymentIntentId',
          'updatedAt',
        ].sort(),
      );

      const again = await pay('flight', bookingId).expect(409);
      expect(again.body.message).toContain(
        `/api/payments/${created.body.id}/retry`,
      );
      const pending = await call(
        'get',
        `/payments/${created.body.id}`,
        'traveler',
      ).expect(200);
      expect(pending.body.bookingStatus).toBe('pending_payment');

      await webhook('payment_intent.succeeded', {
        id: 'pi_unknown',
        object: 'payment_intent',
        status: 'succeeded',
      }).expect(200);
      await webhook(
        'payment_intent.succeeded',
        { id: stripe.intents.get(stored!.stripePaymentIntentId)!.id },
        'whsec_wrong',
      ).expect(400);
      await request(server())
        .post('/api/payments/webhook')
        .send({})
        .expect(400);

      const intent = stripe.intents.get(stored!.stripePaymentIntentId)!;
      intent.status = 'succeeded';
      const event = {
        id: intent.id,
        object: 'payment_intent',
        status: 'succeeded',
        amount: intent.amount,
        currency: 'egp',
      };
      await webhook('payment_intent.succeeded', event).expect(200);
      await webhook('payment_intent.succeeded', event).expect(200);

      const booking = await models.flightBookings.findById(bookingId);
      expect(booking!.status).toBe(BookingStatus.CONFIRMED);
      expect(booking!.reference).toMatch(/^[A-Z2-9]{6}$/);
      await expect(
        models.notifications.countDocuments({
          subjectId: booking!._id,
          type: NotificationType.BOOKING_CONFIRMED,
        }),
      ).resolves.toBe(1);
      const paid = await call(
        'get',
        `/payments/${created.body.id}`,
        'traveler',
      ).expect(200);
      expect(paid.body).toMatchObject({
        status: 'succeeded',
        bookingStatus: 'confirmed',
        bookingReference: booking!.reference,
      });
      expect(paid.body.clientSecret).toBeUndefined();
      await call('get', `/payments/${created.body.id}`, 'other').expect(404);
      await pay('flight', bookingId).expect(409);
    });

    it('shows a declined card and lets the traveler retry until it succeeds', async () => {
      const bookingId = await holdHotel(50);
      await accept('hotel', bookingId);
      await pay('hotel', bookingId, {
        testPaymentMethod: 'not-a-token',
      }).expect(400);

      const declined = await pay('hotel', bookingId, {
        testPaymentMethod: 'pm_card_chargeDeclined',
      }).expect(402);
      expect(declined.body.message).toMatch(/declined.*Retry/);
      const paymentId = declined.body.paymentId as string;
      expect((await models.payments.findById(paymentId))!.status).toBe(
        PaymentStatus.FAILED,
      );

      await call('post', `/payments/${paymentId}/retry`, 'traveler')
        .send({ testPaymentMethod: 'pm_card_chargeDeclined' })
        .expect(402);
      const retried = await call(
        'post',
        `/payments/${paymentId}/retry`,
        'traveler',
      )
        .send({ testPaymentMethod: 'pm_card_visa' })
        .expect(200);
      expect(retried.body).toMatchObject({
        status: 'succeeded',
        bookingStatus: 'confirmed',
      });
      expect(retried.body.bookingReference).toBeDefined();
      await call('post', `/payments/${paymentId}/retry`, 'traveler')
        .send({})
        .expect(409);
    });

    it('cancels the PaymentIntent when the hold expires', async () => {
      const bookingId = await holdFlight();
      await accept('flight', bookingId);
      const created = await pay('flight', bookingId).expect(201);
      await models.flightBookings.updateOne(
        { _id: bookingId },
        { holdExpiresAt: new Date(Date.now() - 1000) },
      );
      await app.get(FlightBookingLifecycleService).expireDueHolds();
      await payments.sweep();

      const payment = await models.payments.findById(created.body.id);
      expect(payment!.status).toBe(PaymentStatus.CANCELLED);
      expect(stripe.intents.get(payment!.stripePaymentIntentId)!.status).toBe(
        'canceled',
      );
      await call('post', `/payments/${created.body.id}/retry`, 'traveler')
        .send({})
        .expect(409);
      await pay('flight', bookingId).expect(409);
    });

    it('refunds a payment that succeeds after the hold ended', async () => {
      const bookingId = await holdFlight();
      await accept('flight', bookingId);
      const created = await pay('flight', bookingId).expect(201);
      await models.flightBookings.updateOne(
        { _id: bookingId },
        { holdExpiresAt: new Date(Date.now() - 1000) },
      );
      await app.get(FlightBookingLifecycleService).expireDueHolds();

      const payment = await models.payments.findById(created.body.id);
      const intent = stripe.intents.get(payment!.stripePaymentIntentId)!;
      intent.status = 'succeeded';
      await webhook('payment_intent.succeeded', {
        id: intent.id,
        object: 'payment_intent',
        status: 'succeeded',
      }).expect(200);

      expect((await models.flightBookings.findById(bookingId))!.status).toBe(
        BookingStatus.EXPIRED,
      );
      const refund = await models.refunds.findOne({ paymentId: payment!._id });
      expect(refund).toMatchObject({
        amountMinorUnits: 300_000,
        status: RefundStatus.REFUNDED,
      });
    });
  });

  describe('refunds (PAY-03)', () => {
    it('sends a cancellation refund through Stripe and shows its status', async () => {
      const bookingId = await holdHotel(10);
      await accept('hotel', bookingId);
      await pay('hotel', bookingId, {
        testPaymentMethod: 'pm_card_visa',
      }).expect(201);

      const cancelled = await call(
        'post',
        `/hotel-bookings/${bookingId}/cancel`,
        'traveler',
      )
        .send({ confirm: true })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        refundPercentage: 50,
        refundMinorUnits: 100_000,
        refundStatus: 'pending',
      });
      const before = await call(
        'get',
        `/hotel-bookings/${bookingId}`,
        'traveler',
      ).expect(200);
      expect(before.body.refund).toMatchObject({
        status: 'pending',
        amountMinorUnits: 100_000,
      });

      const calls = stripe.refundCalls.length;
      await payments.sweep();
      await payments.sweep();
      expect(stripe.refundCalls.length).toBe(calls + 1);
      expect(stripe.refundCalls.at(-1)).toMatchObject({
        amountMinorUnits: 100_000,
      });

      const after = await call(
        'get',
        `/hotel-bookings/${bookingId}`,
        'traveler',
      ).expect(200);
      expect(after.body.refund.status).toBe('refunded');
      const refund = await call(
        'get',
        `/refunds/${after.body.refund.id}`,
        'traveler',
      ).expect(200);
      expect(refund.body).toMatchObject({
        status: 'refunded',
        bookingType: 'hotel',
        bookingId,
        currency: 'EGP',
      });
      await call('get', `/refunds/${after.body.refund.id}`, 'other').expect(
        404,
      );
      await expect(
        models.notifications.countDocuments({
          recipientId: ids.traveler,
          type: NotificationType.REFUND_UPDATED,
        }),
      ).resolves.toBeGreaterThanOrEqual(1);
    });

    it('records a refund that Stripe reports as failed', async () => {
      const bookingId = await holdHotel(20);
      await accept('hotel', bookingId);
      await pay('hotel', bookingId, {
        testPaymentMethod: 'pm_card_visa',
      }).expect(201);
      await call('post', `/hotel-bookings/${bookingId}/cancel`, 'traveler')
        .send({ confirm: true })
        .expect(200);
      await payments.sweep();
      const details = await call(
        'get',
        `/hotel-bookings/${bookingId}`,
        'traveler',
      ).expect(200);
      const stored = await models.refunds.findById(details.body.refund.id);

      // A later webhook can't undo a finished refund...
      await webhook('refund.updated', {
        id: stored!.stripeRefundId,
        object: 'refund',
        status: 'failed',
      }).expect(200);
      expect((await models.refunds.findById(stored!._id))!.status).toBe(
        RefundStatus.REFUNDED,
      );

      // ...but a pending one can fail.
      await models.refunds.updateOne(
        { _id: stored!._id },
        { status: RefundStatus.PENDING },
      );
      stripe.refunds.set(stored!.stripeRefundId!, {
        id: stored!.stripeRefundId!,
        status: 'failed',
      });
      await webhook('refund.updated', {
        id: stored!.stripeRefundId,
        object: 'refund',
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      }).expect(200);
      expect((await models.refunds.findById(stored!._id))!.status).toBe(
        RefundStatus.FAILED,
      );
    });
  });
  describe('Phase 13 refund resilience', () => {
    it.each(['succeeded', 'failed'] as const)(
      'rolls back a %s refund status when its notification fails, then retries exactly once',
      async (remoteStatus) => {
        const bookingId = await holdHotel(
          remoteStatus === 'succeeded' ? 140 : 150,
        );
        await accept('hotel', bookingId);
        const payment = (
          await pay('hotel', bookingId, {
            testPaymentMethod: 'pm_card_visa',
          }).expect(201)
        ).body;
        await call('post', `/hotel-bookings/${bookingId}/cancel`, 'traveler')
          .send({ confirm: true })
          .expect(200);
        const refund = (await models.refunds.findOne({
          paymentId: payment.id,
        }))!;
        const stripeRefundId = `re_phase13_${refund.id}`;
        await models.refunds.updateOne(
          { _id: refund._id },
          { $set: { stripeRefundId } },
        );
        const state = {
          id: stripeRefundId,
          object: 'refund',
          status: remoteStatus,
        };
        const spy = jest
          .spyOn(models.notifications, 'updateOne')
          .mockImplementationOnce(() => {
            throw new Error('simulated notification failure');
          });
        try {
          await webhook('refund.updated', state).expect(500);
          expect((await models.refunds.findById(refund._id))!.status).toBe(
            RefundStatus.PENDING,
          );
        } finally {
          spy.mockRestore();
        }
        await webhook('refund.updated', state).expect(200);
        await webhook('refund.updated', state).expect(200);
        expect((await models.refunds.findById(refund._id))!.status).toBe(
          remoteStatus === 'succeeded'
            ? RefundStatus.REFUNDED
            : RefundStatus.FAILED,
        );
        expect(
          await models.notifications.countDocuments({
            subjectId: refund._id,
            type: NotificationType.REFUND_UPDATED,
          }),
        ).toBe(1);
      },
    );
    it('processes later refunds even when the first 100 remain pending at Stripe', async () => {
      const bookingId = await holdHotel(160);
      const paymentsBatch = await models.payments.create(
        Array.from({ length: 101 }, (_, i) => ({
          bookingModel: 'HotelBooking',
          bookingId,
          stripePaymentIntentId: `pi_phase13_batch_${i}`,
          amountMinorUnits: 100,
          currency: 'EGP',
          status: PaymentStatus.CANCELLED,
          stripeReconciledAt: new Date(),
        })),
      );
      const refundRows = await models.refunds.create(
        paymentsBatch.map((payment, i) => ({
          paymentId: payment._id,
          amountMinorUnits: 100,
          currency: 'EGP',
          stripeRefundId: i < 100 ? `re_phase13_pending_${i}` : undefined,
        })),
        { ordered: true },
      );
      for (let i = 0; i < 100; i++)
        stripe.refunds.set(`re_phase13_pending_${i}`, {
          id: `re_phase13_pending_${i}`,
          status: 'pending',
        });
      try {
        await app.get(RefundsService).dispatchPending();
        expect(
          (await models.refunds.findById(refundRows[100]._id))!.status,
        ).toBe(RefundStatus.REFUNDED);
        expect(
          await models.refunds.countDocuments({
            _id: { $in: refundRows.slice(0, 100).map((r) => r._id) },
            status: RefundStatus.PENDING,
          }),
        ).toBe(100);
      } finally {
        await models.notifications.deleteMany({
          subjectId: { $in: refundRows.map((r) => r._id) },
        });
        await models.refunds.deleteMany({
          _id: { $in: refundRows.map((r) => r._id) },
        });
        await models.payments.deleteMany({
          _id: { $in: paymentsBatch.map((p) => p._id) },
        });
      }
    });
  });
  describe('audit regressions', () => {
    it('refunds a successful charge discovered after provider cancellation even without a webhook', async () => {
      const bookingId = await holdFlight();
      await accept('flight', bookingId);
      const response = await pay('flight', bookingId).expect(201);
      const payment = (await models.payments.findById(response.body.id))!;
      // Legacy provider cancellation has already closed the local payment.
      await models.flightBookings.updateOne(
        { _id: bookingId },
        { $set: { status: BookingStatus.EXPIRED } },
      );
      await models.payments.updateOne(
        { _id: payment._id },
        { $set: { status: PaymentStatus.CANCELLED } },
      );
      stripe.intents.get(payment.stripePaymentIntentId)!.status = 'succeeded';
      await payments.sweep();
      expect(
        await models.refunds.findOne({ paymentId: payment._id }).lean(),
      ).toMatchObject({
        amountMinorUnits: payment.amountMinorUnits,
        status: RefundStatus.REFUNDED,
      });
      expect((await models.flightBookings.findById(bookingId))!.status).toBe(
        BookingStatus.EXPIRED,
      );
    });

    it('uses one Stripe intent/local payment when creation requests race', async () => {
      const bookingId = await holdHotel(100);
      await accept('hotel', bookingId);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => pay('hotel', bookingId)),
      );
      expect(
        results
          .map((r) => r.status)
          .every((status) => status === 201 || status === 409),
      ).toBe(true);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await models.payments.countDocuments({ bookingId })).toBe(1);
    });

    it('refunds an extra captured payment when the succeeded-payment unique index rejects it, exactly once', async () => {
      const bookingId = await holdHotel(110);
      await accept('hotel', bookingId);
      const first = await pay('hotel', bookingId, {
        testPaymentMethod: 'pm_card_visa',
      }).expect(201);
      const initial = (await models.payments.findById(first.body.id))!;
      const extraId = `pi_extra_${++sequence}`;
      const extra = await models.payments.create({
        bookingModel: initial.bookingModel,
        bookingId: initial.bookingId,
        stripePaymentIntentId: extraId,
        amountMinorUnits: initial.amountMinorUnits,
        currency: initial.currency,
        status: PaymentStatus.PENDING,
      });
      const state: IntentState = {
        id: extraId,
        amount: extra.amountMinorUnits,
        currency: 'egp',
        status: 'succeeded',
        clientSecret: null,
      };
      stripe.intents.set(extraId, state);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          payments.applyIntent(extra.toObject(), state),
        ),
      );
      expect(
        await models.refunds.countDocuments({ paymentId: extra._id }),
      ).toBe(1);
      expect(
        (await models.refunds.findOne({ paymentId: extra._id }))!.status,
      ).toBe(RefundStatus.REFUNDED);
      expect(
        stripe.refundCalls.filter((call) => call.paymentIntentId === extraId),
      ).toHaveLength(1);
      expect((await models.hotelBookings.findById(bookingId))!.status).toBe(
        BookingStatus.CONFIRMED,
      );
      const shown = await call(
        'get',
        `/payments/${extra.id}`,
        'traveler',
      ).expect(200);
      expect(shown.body).toMatchObject({
        status: 'succeeded',
        refund: {
          status: 'refunded',
          amountMinorUnits: extra.amountMinorUnits,
        },
      });
      await call('post', `/payments/${extra.id}/retry`, 'traveler')
        .send({})
        .expect(409);
    });

    it('blocks deactivation before a hotel-local check-in across UTC midnight and permits it after checkout', async () => {
      await addUser('tzTraveler', UserRole.TRAVELER);
      const owner = (await models.users.findById(ids.tzTraveler))!;
      await models.hotelBookings.create({
        userId: owner._id,
        hotelId,
        checkInDate: '2031-01-15',
        checkOutDate: '2031-01-16',
        timeZone: 'America/Los_Angeles',
        rooms: [
          {
            roomId: roomIds[0],
            label: 'TZ room',
            maxOccupancy: 2,
            nightlyPriceMinorUnits: 1000,
            adults: 1,
            childAges: [],
          },
        ],
        status: BookingStatus.CONFIRMED,
        reference: `TZ-${++sequence}`,
        holdExpiresAt: new Date(),
        policyAcceptedAt: new Date(),
        policy: {
          checkInTime: '18:00',
          checkOutTime: '11:00',
          cancellationTiers: [],
        },
        currency: 'EGP',
        totalMinorUnits: 1000,
      });
      const guard = app.get(AccountDeactivationService);
      await expect(
        guard.deactivateOwnAccount(
          owner._id,
          { currentPassword: PASSWORD, confirm: true },
          new Date('2031-01-16T01:00:00Z'),
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect((await models.users.findById(owner._id))!.status).toBe(
        UserStatus.ACTIVE,
      );
      expect(
        await guard.hasUpcomingConfirmedBookings(
          owner._id,
          new Date('2031-01-16T19:00:00Z'),
        ),
      ).toBe(false);
    });
    it('reconciles locally cancelled provider payments and stops polling once Stripe confirms cancellation', async () => {
      const bookingId = await holdFlight();
      await accept('flight', bookingId);
      const response = await pay('flight', bookingId).expect(201);
      const booking = (await models.flightBookings.findById(bookingId))!;
      const flight = (await models.flights.findById(
        booking.segments[0].flightId,
      ))!;
      const moderator = await models.users.findOne({
        role: UserRole.AIRLINE_MODERATOR,
      });
      moderator!.assignedProviderId = flight.airlineId;
      await app.get(FlightManagementService).cancel(moderator!, flight.id);
      const payment = (await models.payments.findById(response.body.id))!;
      expect(payment.status).toBe(PaymentStatus.CANCELLED);
      await payments.sweep();
      expect(stripe.intents.get(payment.stripePaymentIntentId)!.status).toBe(
        'canceled',
      );
      const calls = stripe.cancelCalls.filter(
        (id) => id === payment.stripePaymentIntentId,
      ).length;
      await payments.sweep();
      expect(
        stripe.cancelCalls.filter((id) => id === payment.stripePaymentIntentId),
      ).toHaveLength(calls);
    });
  });
});
