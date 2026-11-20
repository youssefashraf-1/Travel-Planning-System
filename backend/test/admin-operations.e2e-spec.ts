import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { AuditAction } from '../src/audit-logs/schemas/audit-log.schema';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { FlightBookingLifecycleService } from '../src/flight-bookings/flight-booking-lifecycle.service';
import { HotelBookingLifecycleService } from '../src/hotel-bookings/hotel-booking-lifecycle.service';
import { PaymentsService } from '../src/payments/payments.service';
import { UserRole } from '../src/users/schemas/user.schema';

const TAG = 'phase12.admin.test';
const PASSWORD = 'TestPassword2026';
const CITY = 'phase12-test-city';
const START = '2027-03-02';

describe('Phase 12 Group A administrator operations', () => {
  let app: INestApplication<App>;
  const m: Record<string, Model<any>> = {};
  const users: Record<string, Types.ObjectId> = {};
  const cookies: Record<string, string[]> = {};
  let airlineId: Types.ObjectId,
    otherAirlineId: Types.ObjectId,
    hotelId: Types.ObjectId,
    flightId: Types.ObjectId,
    roomId: Types.ObjectId;
  let confirmedFlight: string, confirmedHotel: string;
  let flightLifecycle: FlightBookingLifecycleService,
    hotelLifecycle: HotelBookingLifecycleService;
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const r = request(app.getHttpServer())[method]('/api' + path);
    return who ? r.set('Cookie', cookies[who]) : r;
  };
  const change = (
    type: string,
    id: Types.ObjectId,
    action = 'deactivate',
    who = 'admin',
  ) =>
    call(
      'patch',
      `/admin/providers/${type}/${id.toString()}/${action}`,
      who,
    ).send({ confirm: true });
  const holdFlight = async (who = 'other') =>
    (
      await call('post', '/flight-bookings/hold', who)
        .send({
          outboundFlightId: flightId.toString(),
          outboundCabinClass: 'economy',
          passengers: [
            {
              type: 'adult',
              fullName: 'Test Passenger',
              dateOfBirth: '1990-01-01',
              passportOrIdNumber: 'PRIVATE-DOCUMENT-123456',
            },
          ],
        })
        .expect(201)
    ).body.id as string;
  const holdHotel = async (
    who = 'other',
    checkInDate = '2027-03-05',
    checkOutDate = '2027-03-07',
  ) =>
    (
      await call('post', '/hotel-bookings', who)
        .send({
          hotelId: hotelId.toString(),
          checkInDate,
          checkOutDate,
          rooms: [{ roomId: roomId.toString(), adults: 1 }],
        })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication({ rawBody: true });
    app.useLogger(false);
    configureApp(app);
    await app.init();
    for (const name of [
      'User',
      'Session',
      'Airline',
      'Airport',
      'Flight',
      'CabinInventory',
      'Hotel',
      'Room',
      'RoomAvailability',
      'FlightBooking',
      'HotelBooking',
      'AuditLog',
      'Notification',
      'Payment',
      'Refund',
      'Country',
      'City',
    ])
      m[name] = app.get(getModelToken(name));
    await Promise.all(Object.values(m).map((model) => model.init()));
    airlineId = (
      await m.Airline.create({
        name: 'Phase12 Airline [A]',
        code: 'P12A',
        cancellationTiers: [{ daysBeforeDeparture: 0, refundPercentage: 100 }],
      })
    )._id;
    otherAirlineId = (
      await m.Airline.create({ name: 'Phase12 Other Airline', code: 'P12B' })
    )._id;
    await m.Country.create({
      _id: 'QZ',
      name: 'Phase12 Country',
      currencyCode: 'EGP',
    });
    await m.City.create({ _id: CITY, name: 'Phase12 City', countryCode: 'QZ' });
    const policy = {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [{ daysBeforeCheckIn: 0, refundPercentage: 100 }],
    };
    hotelId = (
      await m.Hotel.create({
        name: 'Phase12 Hotel',
        address: 'Test',
        cityId: CITY,
        countryCode: 'QZ',
        timeZone: 'Africa/Cairo',
        description: 'Test',
        starClass: 3,
        policy,
      })
    )._id;
    const airports = await m.Airport.create([
      {
        iataCode: 'XQA',
        name: 'Phase12 A',
        cityId: CITY,
        countryCode: 'QZ',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'XQB',
        name: 'Phase12 B',
        cityId: CITY,
        countryCode: 'QZ',
        timeZone: 'Europe/Paris',
      },
    ]);
    // UTC March 1, but March 2 at the departure airport: date filtering must use the local date.
    flightId = (
      await m.Flight.create({
        airlineId,
        flightNumber: 'P1201',
        departureAirportId: airports[0]._id,
        arrivalAirportId: airports[1]._id,
        departureAt: new Date('2027-03-01T23:30:00Z'),
        arrivalAt: new Date('2027-03-02T03:30:00Z'),
        departureLocalDate: START,
        status: 'scheduled',
      })
    )._id;
    await m.CabinInventory.create({
      flightId,
      cabinClass: 'economy',
      totalSeats: 50,
      priceMinorUnits: 300000,
      freeBagCount: 1,
      maxBagWeightKg: 23,
    });
    roomId = (
      await m.Room.create({
        hotelId,
        label: 'G-A',
        roomType: 'Double',
        bedCount: 1,
        maxOccupancy: 2,
        nightlyPriceMinorUnits: 100000,
      })
    )._id;
    await m.RoomAvailability.create({
      roomId,
      bookableRanges: [{ fromDate: '2027-01-01', untilDate: '2027-12-31' }],
    });
    const hash = await app.get(PasswordHasherService).hash(PASSWORD);
    for (const [name, role, provider] of [
      ['admin', UserRole.ADMIN],
      ['secondAdmin', UserRole.ADMIN],
      ['traveler', UserRole.TRAVELER],
      ['other', UserRole.TRAVELER],
      ['airMod', UserRole.AIRLINE_MODERATOR, airlineId],
      ['hotelMod', UserRole.HOTEL_MODERATOR, hotelId],
      ['otherMod', UserRole.AIRLINE_MODERATOR, otherAirlineId],
    ] as const) {
      const user = await m.User.create({
        name,
        email: `${name.toLowerCase()}@${TAG}`,
        passwordHash: hash,
        role,
        assignedProviderId: provider,
      });
      users[name] = user._id;
      const login = await call('post', '/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      cookies[name] = ([] as string[])
        .concat(login.headers['set-cookie'] ?? [])
        .map((c) => c.split(';')[0]);
    }
    flightLifecycle = app.get(FlightBookingLifecycleService);
    hotelLifecycle = app.get(HotelBookingLifecycleService);
    confirmedFlight = await holdFlight('traveler');
    confirmedHotel = await holdHotel('traveler', START, '2027-03-04');
    for (const [type, id] of [
      ['flight', confirmedFlight],
      ['hotel', confirmedHotel],
    ])
      await call('post', `/bookings/${type}/${id}/accept-policies`, 'traveler')
        .send({ accept: true })
        .expect(200);
    await flightLifecycle.confirmPaidBooking(confirmedFlight);
    await hotelLifecycle.confirmPaidReservation(confirmedHotel);
  });

  beforeEach(async () => {
    await m.Airline.updateOne({ _id: airlineId }, { $set: { isActive: true } });
    await m.Hotel.updateOne({ _id: hotelId }, { $set: { isActive: true } });
    for (const name of ['FlightBooking', 'HotelBooking'])
      await m[name].updateMany(
        { userId: { $in: Object.values(users) }, status: 'pending_payment' },
        { $set: { holdExpiresAt: new Date(0) } },
      );
    await flightLifecycle.expireDueHolds();
    await hotelLifecycle.expireDueHolds();
  });

  afterAll(async () => {
    if (m.User) {
      const ids = Object.values(users);
      const payments = (
        await m.Payment.find({
          bookingId: {
            $in: [
              ...(await m.FlightBooking.find({ userId: { $in: ids } })).map(
                (b) => b._id,
              ),
              ...(await m.HotelBooking.find({ userId: { $in: ids } })).map(
                (b) => b._id,
              ),
            ],
          },
        })
      ).map((p) => p._id);
      await m.Refund.deleteMany({ paymentId: { $in: payments } });
      await m.Payment.deleteMany({ _id: { $in: payments } });
      await m.FlightBooking.deleteMany({ userId: { $in: ids } });
      await m.HotelBooking.deleteMany({ userId: { $in: ids } });
      await m.AuditLog.deleteMany({ actorId: { $in: ids } });
      await m.Notification.deleteMany({ recipientId: { $in: ids } });
      await m.Session.deleteMany({ userId: { $in: ids } });
      await m.User.deleteMany({ _id: { $in: ids } });
      await m.CabinInventory.deleteMany({ flightId });
      await m.Flight.deleteOne({ _id: flightId });
      await m.Airport.deleteMany({ iataCode: { $in: ['XQA', 'XQB'] } });
      await m.Airline.deleteMany({ _id: { $in: [airlineId, otherAirlineId] } });
      await m.RoomAvailability.deleteMany({ roomId });
      await m.Room.deleteOne({ _id: roomId });
      await m.Hotel.deleteOne({ _id: hotelId });
      await m.City.deleteOne({ _id: CITY });
      await m.Country.deleteOne({ _id: 'QZ' });
    }
    if (app) await app.close();
  });

  it('requires admin access for every new operation', async () => {
    for (const path of [
      '/admin/providers/airline',
      '/admin/bookings',
      '/admin/audit-logs',
    ]) {
      await call('get', path).expect(401);
      for (const who of ['traveler', 'airMod', 'hotelMod'])
        await call('get', path, who).expect(403);
    }
    await call(
      'patch',
      `/admin/providers/airline/${airlineId.toString()}/deactivate`,
    )
      .send({ confirm: true })
      .expect(401);
    for (const who of ['traveler', 'airMod', 'hotelMod'])
      await change('airline', airlineId, 'deactivate', who).expect(403);
  });

  it.each(['airline', 'hotel'])(
    'deactivates/reactivates %s, preserves confirmed bookings, notifies affected people and audits once',
    async (type) => {
      const id = type === 'airline' ? airlineId : hotelId;
      const model = type === 'airline' ? m.FlightBooking : m.HotelBooking;
      const confirmed = type === 'airline' ? confirmedFlight : confirmedHotel;
      const pending =
        type === 'airline' ? await holdFlight() : await holdHotel();
      const before = await model.collection.findOne({
        _id: new Types.ObjectId(confirmed),
      });
      const updated = (await change(type, id).expect(200)).body;
      expect(updated.isActive).toBe(false);
      expect(
        await model.collection.findOne({ _id: new Types.ObjectId(confirmed) }),
      ).toEqual(before);
      expect(
        (await model.findById(pending)).holdExpiresAt.getTime(),
      ).toBeLessThanOrEqual(Date.now());
      const entry = await m.AuditLog.findOne({
        targetId: id,
        action: AuditAction.PROVIDER_DEACTIVATED,
      }).sort({ createdAt: -1, _id: -1 });
      const notifications = await m.Notification.find({
        eventKey: `provider-status:${entry.id}`,
      });
      expect(
        new Set(notifications.map((n) => n.recipientId.toString())),
      ).toEqual(
        new Set([
          users.traveler.toString(),
          users.other.toString(),
          users[type === 'airline' ? 'airMod' : 'hotelMod'].toString(),
        ]),
      );
      expect(
        notifications.every((n) => n.type === 'provider_status_changed'),
      ).toBe(true);
      await change(type, id).expect(409);
      if (type === 'airline') {
        await call('post', '/flight-bookings/hold', 'other')
          .send({
            outboundFlightId: flightId.toString(),
            outboundCabinClass: 'economy',
            passengers: [
              {
                type: 'adult',
                fullName: 'Test',
                dateOfBirth: '1990-01-01',
                passportOrIdNumber: 'TEST-123',
              },
            ],
          })
          .expect(409);
        const search = (
          await call(
            'get',
            `/flights/search?departureAirportId=${(await m.Flight.findById(flightId)).departureAirportId.toString()}&arrivalAirportId=${(await m.Flight.findById(flightId)).arrivalAirportId.toString()}&departureDate=${START}&adults=1`,
          ).expect(200)
        ).body;
        expect(JSON.stringify(search)).not.toContain(flightId.toString());
        await expect(
          flightLifecycle.confirmPaidBooking(pending),
        ).rejects.toMatchObject({ status: 409 });
      } else {
        await call('post', '/hotel-bookings', 'other')
          .send({
            hotelId: id.toString(),
            checkInDate: '2027-03-08',
            checkOutDate: '2027-03-10',
            rooms: [{ roomId: roomId.toString(), adults: 1 }],
          })
          .expect(409);
        const search = (
          await call(
            'get',
            `/hotels/search?cityId=${CITY}&checkInDate=2027-03-08&checkOutDate=2027-03-10&guests=1`,
          ).expect(200)
        ).body;
        expect(JSON.stringify(search)).not.toContain(hotelId.toString());
        await expect(
          hotelLifecycle.confirmPaidReservation(pending),
        ).rejects.toMatchObject({ status: 409 });
      }
      const active = (await change(type, id, 'reactivate').expect(200)).body;
      expect(active.isActive).toBe(true);
      await change(type, id, 'reactivate').expect(409);
      expect(
        (await model.findById(pending)).holdExpiresAt.getTime(),
      ).toBeLessThanOrEqual(Date.now());
      expect((await model.findById(confirmed)).status).toBe('confirmed');
    },
  );

  it('keeps provider status independent from moderator suspension', async () => {
    await change('airline', airlineId).expect(200);
    await call('get', '/auth/me', 'airMod').expect(200);
    await m.User.updateOne(
      { _id: users.airMod },
      { $set: { status: 'suspended' } },
    );
    try {
      await change('airline', airlineId, 'reactivate').expect(200);
      expect((await m.User.findById(users.airMod)).status).toBe('suspended');
    } finally {
      await m.User.updateOne(
        { _id: users.airMod },
        { $set: { status: 'active' } },
      );
    }
  });

  it('lists inactive providers with validated boolean and literal name filters', async () => {
    await change('airline', airlineId).expect(200);
    const inactive = (
      await call(
        'get',
        '/admin/providers/airline?isActive=false',
        'admin',
      ).expect(200)
    ).body;
    expect(inactive.items.map((p: { id: string }) => p.id)).toContain(
      airlineId.toString(),
    );
    expect(
      (
        await call(
          'get',
          '/admin/providers/airline?search=%5BA%5D',
          'admin',
        ).expect(200)
      ).body.totalItems,
    ).toBe(1);
    expect(
      (
        await call('get', '/admin/providers/airline?search=.*', 'admin').expect(
          200,
        )
      ).body.totalItems,
    ).toBe(0);
    await call('get', '/admin/providers/airline?isActive=1', 'admin').expect(
      400,
    );
    await call('get', '/admin/providers/unknown', 'admin').expect(400);
    for (const body of [
      {},
      { confirm: false },
      { confirm: 'true' },
      { confirm: true, role: 'admin' },
    ])
      await call(
        'patch',
        `/admin/providers/hotel/${hotelId.toString()}/deactivate`,
        'admin',
      )
        .send(body)
        .expect(400);
    await call('patch', '/admin/providers/hotel/not-an-id/deactivate', 'admin')
      .send({ confirm: true })
      .expect(404);
    await call(
      'patch',
      `/admin/providers/hotel/${new Types.ObjectId().toString()}/deactivate`,
      'admin',
    )
      .send({ confirm: true })
      .expect(404);
  });

  it('rolls back provider, pending holds and notifications if audit writing fails', async () => {
    const pending = await holdFlight();
    const before = (await m.FlightBooking.findById(pending)).holdExpiresAt;
    const count = await m.Notification.countDocuments({ subjectId: airlineId });
    const failure = jest
      .spyOn(m.AuditLog, 'create')
      .mockImplementationOnce(() => {
        throw new Error('Audit unavailable');
      });
    try {
      await change('airline', airlineId).expect(500);
    } finally {
      failure.mockRestore();
    }
    expect((await m.Airline.findById(airlineId)).isActive).toBe(true);
    expect((await m.FlightBooking.findById(pending)).holdExpiresAt).toEqual(
      before,
    );
    expect(await m.Notification.countDocuments({ subjectId: airlineId })).toBe(
      count,
    );
  });

  it('rolls back the entire change if notification storage fails', async () => {
    const before = await m.AuditLog.countDocuments({ targetId: hotelId });
    const failure = jest
      .spyOn(m.Notification, 'create')
      .mockImplementationOnce(() => {
        throw new Error('Notifications unavailable');
      });
    try {
      await change('hotel', hotelId).expect(500);
    } finally {
      failure.mockRestore();
    }
    expect((await m.Hotel.findById(hotelId)).isActive).toBe(true);
    expect(await m.AuditLog.countDocuments({ targetId: hotelId })).toBe(before);
  });

  it('serializes simultaneous provider deactivations', async () => {
    const before = await m.AuditLog.countDocuments({
      targetId: airlineId,
      action: AuditAction.PROVIDER_DEACTIVATED,
    });
    const results = await Promise.all([
      change('airline', airlineId),
      change('airline', airlineId),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      await m.AuditLog.countDocuments({
        targetId: airlineId,
        action: AuditAction.PROVIDER_DEACTIVATED,
      }),
    ).toBe(before + 1);
  });

  it('does not retain a payable hold when hold creation races provider deactivation', async () => {
    const results = await Promise.all([
      call('post', '/hotel-bookings', 'other').send({
        hotelId: hotelId.toString(),
        checkInDate: '2027-03-10',
        checkOutDate: '2027-03-12',
        rooms: [{ roomId: roomId.toString(), adults: 1 }],
      }),
      change('hotel', hotelId),
    ]);
    expect(results[1].status).toBe(200);
    expect([201, 409]).toContain(results[0].status);
    expect(
      await m.HotelBooking.countDocuments({
        hotelId,
        status: 'pending_payment',
        holdExpiresAt: { $gt: new Date() },
      }),
    ).toBe(0);
  });

  it('queues a full refund for a payment captured after provider deactivation', async () => {
    const id = await holdFlight();
    await call('post', `/bookings/flight/${id}/accept-policies`, 'other')
      .send({ accept: true })
      .expect(200);
    const payment = await m.Payment.create({
      bookingModel: 'FlightBooking',
      bookingId: id,
      stripePaymentIntentId: 'pi_phase12_' + id,
      amountMinorUnits: 300000,
      currency: 'EGP',
    });
    await change('airline', airlineId).expect(200);
    await app.get(PaymentsService).applyIntent(payment, {
      id: payment.stripePaymentIntentId,
      status: 'succeeded',
      amount: 300000,
      currency: 'egp',
      clientSecret: null,
    });
    const refund = await m.Refund.findOne({ paymentId: payment._id });
    expect(refund.amountMinorUnits).toBe(300000);
    expect(refund.status).toBe('pending');
    await flightLifecycle.expireDueHolds();
    expect((await m.FlightBooking.findById(id)).status).toBe('expired');
    expect((await m.FlightBooking.findById(confirmedFlight)).status).toBe(
      'confirmed',
    );
  });

  it('returns read-only booking summaries, local travel dates and no passenger/payment secrets', async () => {
    const before = await m.FlightBooking.collection.findOne({
      _id: new Types.ObjectId(confirmedFlight),
    });
    const result = (
      await call(
        'get',
        `/admin/bookings?type=flight&status=confirmed&fromDate=${START}&toDate=${START}`,
        'admin',
      ).expect(200)
    ).body;
    const row = result.items.find(
      (item: { id: string }) => item.id === confirmedFlight,
    );
    expect(row.reference).toBeDefined();
    expect(row.user.id).toBe(users.traveler.toString());
    expect(row.providers[0].id).toBe(airlineId.toString());
    expect(row.startDate).toBe(START);
    expect(row.amountMinorUnits).toBe(300000);
    expect(JSON.stringify(result)).not.toMatch(
      /passport|passwordHash|PRIVATE-DOCUMENT|stripePaymentIntentId|clientSecret/,
    );
    expect(
      await m.FlightBooking.collection.findOne({
        _id: new Types.ObjectId(confirmedFlight),
      }),
    ).toEqual(before);
    const hotel = (
      await call(
        'get',
        `/admin/bookings?type=hotel&status=confirmed&fromDate=${START}&toDate=${START}`,
        'admin',
      ).expect(200)
    ).body.items.find((item: { id: string }) => item.id === confirmedHotel);
    expect(hotel.startDate).toBe(START);
    expect(hotel.endDate).toBe('2027-03-04');
    expect(hotel.providers[0].id).toBe(hotelId.toString());
    expect(
      (
        await call(
          'get',
          '/admin/bookings?type=flight&fromDate=2027-03-01&toDate=2027-03-01',
          'admin',
        ).expect(200)
      ).body.totalItems,
    ).toBe(0);
  });

  it('combines both booking types into one stable page and applies status/date filters before pagination', async () => {
    for (const [name, id] of [
      ['FlightBooking', confirmedFlight],
      ['HotelBooking', confirmedHotel],
    ]) {
      const original = await m[name].collection.findOne({
        _id: new Types.ObjectId(id),
      });
      for (let i = 0; i < 6; i++) {
        const { _id, ...rest } = original;
        await m[name].collection.insertOne({
          ...rest,
          status: 'cancelled',
          reference: `P12${name[0]}${i}`,
          createdAt: new Date(Date.now() - i * 1000),
        });
      }
    }
    const first = (
      await call(
        'get',
        `/admin/bookings?status=cancelled&fromDate=${START}&toDate=${START}`,
        'admin',
      ).expect(200)
    ).body;
    const second = (
      await call(
        'get',
        `/admin/bookings?status=cancelled&fromDate=${START}&toDate=${START}&page=2`,
        'admin',
      ).expect(200)
    ).body;
    expect(first.totalItems).toBe(12);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(2);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(12);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.type)),
    ).toEqual(new Set(['flight', 'hotel']));
    expect(
      (
        await call(
          'get',
          '/admin/bookings?status=cancelled&type=hotel',
          'admin',
        ).expect(200)
      ).body.totalItems,
    ).toBe(6);
    expect(
      (
        await call(
          'get',
          '/admin/bookings?fromDate=2028-01-01',
          'admin',
        ).expect(200)
      ).body.items,
    ).toEqual([]);
  });

  it.each([
    'type=wrong',
    'status=wrong',
    'fromDate=2027-02-30',
    'fromDate=2027-03-03&toDate=2027-03-01',
    'page=0',
    'page=900719925474099100',
    'unknown=1',
  ])('rejects invalid booking filters %s', async (query) => {
    await call('get', '/admin/bookings?' + query, 'admin').expect(400);
  });

  it('shows immutable audit history with actor/target/action and inclusive UTC date filters', async () => {
    const targetId = new Types.ObjectId();
    for (const date of [
      '2026-11-19T00:00:00.000Z',
      '2026-11-19T23:59:59.999Z',
      '2026-11-20T00:00:00.000Z',
    ])
      await m.AuditLog.create({
        actorId: users.secondAdmin,
        action: AuditAction.REPORT_DISMISSED,
        targetModel: 'Report',
        targetId,
        createdAt: new Date(date),
      });
    const before = await m.AuditLog.countDocuments({
      actorId: users.secondAdmin,
    });
    const result = (
      await call(
        'get',
        `/admin/audit-logs?actorId=${users.secondAdmin.toString()}&targetModel=Report&targetId=${targetId.toString()}&action=report_dismissed&fromDate=2026-11-19&toDate=2026-11-19`,
        'admin',
      ).expect(200)
    ).body;
    expect(result.totalItems).toBe(2);
    expect(result.items[0].actorName).toBe('secondAdmin');
    expect(result.items[0].createdAt).toBe('2026-11-19T23:59:59.999Z');
    expect(
      await m.AuditLog.countDocuments({ actorId: users.secondAdmin }),
    ).toBe(before);
    const id = result.items[0].id;
    for (const method of ['post', 'patch', 'delete'] as const)
      await call(method, '/admin/audit-logs/' + id, 'admin')
        .send({ action: 'changed' })
        .expect(404);
    await call('get', '/admin/audit-logs?actorId=invalid', 'admin').expect(400);
    await call('get', '/admin/audit-logs?action=invalid', 'admin').expect(400);
    await call('get', '/admin/audit-logs?targetModel=Payment', 'admin').expect(
      400,
    );
    await call(
      'get',
      '/admin/audit-logs?fromDate=2026-11-20&toDate=2026-11-19',
      'admin',
    ).expect(400);
  });
});
