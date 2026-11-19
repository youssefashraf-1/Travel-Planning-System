import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import {
  AuditAction,
  AuditLog,
} from '../src/audit-logs/schemas/audit-log.schema';
import { Session } from '../src/auth/schemas/session.schema';
import { seedAdmin } from '../src/auth/seed-admin';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { Notification } from '../src/notifications/schemas/notification.schema';
import { User } from '../src/users/schemas/user.schema';

// All test accounts use this domain so cleanup never touches other records.
const TEST_DOMAIN = 'acc08.e2e.test';
const TRAVELER = `mona@${TEST_DOMAIN}`;
const ADMIN = `admin@${TEST_DOMAIN}`;
const PASSWORD = 'travel2026';
const ADMIN_PASSWORD = 'admin2026pass';

describe('Account security (ACC-07a, ACC-08, ACC-12, ACC-15, ACC-16, ACC-18, e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let auditLogModel: Model<AuditLog>;
  let notificationModel: Model<Notification>;
  let hotelBookingModel: Model<HotelBooking>;

  const server = () => app.getHttpServer();
  const cookiesOf = (response: request.Response) =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0]);
  const login = (email: string, password: string) =>
    request(server()).post('/api/auth/login').send({ email, password });
  const loginCookies = async (email: string, password: string) =>
    cookiesOf(await login(email, password).expect(200));
  const travelerId = async () =>
    (await userModel.findOne({ email: TRAVELER }))!._id.toString();

  const cleanUp = async () => {
    const users = await userModel.find({
      email: new RegExp(`@${TEST_DOMAIN}$`),
    });
    const ids = users.map((user) => user._id);
    await sessionModel.deleteMany({ userId: { $in: ids } });
    await auditLogModel.deleteMany({
      $or: [{ actorId: { $in: ids } }, { targetId: { $in: ids } }],
    });
    await notificationModel.deleteMany({ recipientId: { $in: ids } });
    await hotelBookingModel.collection.deleteMany({ userId: { $in: ids } });
    await userModel.deleteMany({ _id: { $in: ids } });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    connection = app.get(getConnectionToken());
    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    auditLogModel = app.get(getModelToken(AuditLog.name));
    notificationModel = app.get(getModelToken(Notification.name));
    hotelBookingModel = app.get(getModelToken(HotelBooking.name));
    await userModel.init();
    await notificationModel.init();
  });

  beforeEach(async () => {
    await cleanUp();
    await request(server())
      .post('/api/auth/register')
      .send({
        name: 'Mona Hassan',
        email: TRAVELER,
        password: PASSWORD,
        acceptTermsAndPrivacy: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('admin seeding (ACC-18)', () => {
    it('creates the admin once and leaves it unchanged afterwards', async () => {
      const input = { name: 'Admin', email: ADMIN, password: ADMIN_PASSWORD };

      await expect(seedAdmin(connection, input)).resolves.toBe('created');
      await expect(
        seedAdmin(connection, { ...input, password: 'other2026pass' }),
      ).resolves.toBe('exists');

      const response = await login(ADMIN, ADMIN_PASSWORD).expect(200);
      expect(response.body.role).toBe('admin');
    });

    it('refuses to turn an existing traveler into an admin', async () => {
      await expect(
        seedAdmin(connection, {
          name: 'X',
          email: TRAVELER,
          password: ADMIN_PASSWORD,
        }),
      ).rejects.toThrow('already belongs to a traveler account');
    });
  });

  describe('PATCH /api/auth/change-password (ACC-08)', () => {
    const change = (cookies: string[], body: object) =>
      request(server())
        .patch('/api/auth/change-password')
        .set('Cookie', cookies)
        .send(body);

    it('changes the password and logs out other browsers only', async () => {
      const laptop = await loginCookies(TRAVELER, PASSWORD);
      const phone = await loginCookies(TRAVELER, PASSWORD);

      await change(laptop, {
        currentPassword: PASSWORD,
        newPassword: 'journey2027',
      }).expect(204);

      await login(TRAVELER, PASSWORD).expect(401);
      await login(TRAVELER, 'journey2027').expect(200);
      await request(server())
        .get('/api/auth/me')
        .set('Cookie', laptop)
        .expect(200);
      await request(server())
        .get('/api/auth/me')
        .set('Cookie', phone)
        .expect(401);
    });

    it.each([
      [
        'a wrong current password',
        { currentPassword: 'wrong2026', newPassword: 'journey2027' },
      ],
      [
        'a new password without a digit',
        { currentPassword: PASSWORD, newPassword: 'journeyonly' },
      ],
      [
        'the same password again',
        { currentPassword: PASSWORD, newPassword: PASSWORD },
      ],
    ])('returns 400 for %s', async (_case, body) => {
      const cookies = await loginCookies(TRAVELER, PASSWORD);

      await change(cookies, body).expect(400);
      await login(TRAVELER, PASSWORD).expect(200);
    });

    it('returns 401 when not logged in', async () => {
      await change([], {
        currentPassword: PASSWORD,
        newPassword: 'journey2027',
      }).expect(401);
    });
  });

  describe('DELETE /api/users/me (ACC-12)', () => {
    const deactivate = (cookies: string[], body: object) =>
      request(server())
        .delete('/api/users/me')
        .set('Cookie', cookies)
        .send(body);

    it('deactivates the account, clears cookies and blocks login', async () => {
      const cookies = await loginCookies(TRAVELER, PASSWORD);

      const response = await deactivate(cookies, {
        currentPassword: PASSWORD,
        confirm: true,
      }).expect(204);

      expect(response.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^access_token=;.*Expires=Thu, 01 Jan 1970/),
        ]),
      );
      const blocked = await login(TRAVELER, PASSWORD).expect(403);
      expect(blocked.body.message).toBe('This account is deactivated.');
      await request(server())
        .get('/api/auth/me')
        .set('Cookie', cookies)
        .expect(401);
    });

    it.each([
      ['no confirmation', { currentPassword: PASSWORD }],
      ['confirm false', { currentPassword: PASSWORD, confirm: false }],
      ['a wrong password', { currentPassword: 'wrong2026', confirm: true }],
    ])('returns 400 for %s and keeps the account', async (_case, body) => {
      const cookies = await loginCookies(TRAVELER, PASSWORD);

      await deactivate(cookies, body).expect(400);
      await login(TRAVELER, PASSWORD).expect(200);
    });

    it('is blocked by an upcoming confirmed hotel booking', async () => {
      const cookies = await loginCookies(TRAVELER, PASSWORD);
      await hotelBookingModel.collection.insertOne({
        userId: new Types.ObjectId(await travelerId()),
        status: 'confirmed',
        checkInDate: '2099-01-01',
        checkOutDate: '2099-01-03',
      });

      const response = await deactivate(cookies, {
        currentPassword: PASSWORD,
        confirm: true,
      }).expect(409);

      expect(response.body.message).toMatch(/upcoming confirmed bookings/);
      await login(TRAVELER, PASSWORD).expect(200);
    });
  });

  describe('admin account management', () => {
    let admin: string[];

    beforeEach(async () => {
      await seedAdmin(connection, {
        name: 'Admin',
        email: ADMIN,
        password: ADMIN_PASSWORD,
      });
      admin = await loginCookies(ADMIN, ADMIN_PASSWORD);
    });

    const adminCall = (method: 'patch' | 'post', path: string, as = admin) =>
      request(server())[method](path).set('Cookie', as);

    it('only lets administrators use these routes', async () => {
      const traveler = await loginCookies(TRAVELER, PASSWORD);
      const id = await travelerId();

      await adminCall(
        'patch',
        `/api/admin/accounts/${id}/suspend`,
        traveler,
      ).expect(403);
      await request(server())
        .patch(`/api/admin/accounts/${id}/suspend`)
        .expect(401);
    });

    it('suspends a user, ends their sessions, notifies and audits (ACC-16)', async () => {
      const traveler = await loginCookies(TRAVELER, PASSWORD);
      const id = await travelerId();

      const response = await adminCall(
        'patch',
        `/api/admin/accounts/${id}/suspend`,
      ).expect(200);
      expect(response.body.status).toBe('suspended');

      await request(server())
        .get('/api/auth/me')
        .set('Cookie', traveler)
        .expect(401);
      const blocked = await login(TRAVELER, PASSWORD).expect(403);
      expect(blocked.body.message).toBe('This account is suspended.');

      await expect(
        auditLogModel.countDocuments({
          action: AuditAction.ACCOUNT_SUSPENDED,
          targetId: id,
        }),
      ).resolves.toBe(1);
      await expect(
        notificationModel.countDocuments({ recipientId: id }),
      ).resolves.toBe(1);

      await adminCall('patch', `/api/admin/accounts/${id}/suspend`).expect(409);
    });

    it('reactivates a suspended user (ACC-16)', async () => {
      const id = await travelerId();
      await adminCall('patch', `/api/admin/accounts/${id}/suspend`).expect(200);

      const response = await adminCall(
        'patch',
        `/api/admin/accounts/${id}/reactivate`,
      ).expect(200);

      expect(response.body.status).toBe('active');
      await login(TRAVELER, PASSWORD).expect(200);
      await adminCall('patch', `/api/admin/accounts/${id}/reactivate`).expect(
        409,
      );
      await expect(
        notificationModel.countDocuments({ recipientId: id }),
      ).resolves.toBe(2);
    });

    it('cannot target administrators or unknown accounts', async () => {
      const adminId = (await userModel.findOne({ email: ADMIN }))!._id;

      await adminCall(
        'patch',
        `/api/admin/accounts/${adminId.toString()}/suspend`,
      ).expect(403);
      await adminCall(
        'patch',
        `/api/admin/accounts/${new Types.ObjectId().toString()}/suspend`,
      ).expect(404);
      await adminCall('patch', '/api/admin/accounts/not-an-id/suspend').expect(
        404,
      );
    });

    it('resets a password; the user must change it before anything else (ACC-07a)', async () => {
      const id = await travelerId();

      const reset = await adminCall(
        'post',
        `/api/admin/users/${id}/reset-password`,
      )
        .send({ temporaryPassword: 'Temp2026pass' })
        .expect(200);
      expect(reset.body.mustChangePassword).toBe(true);
      await expect(
        auditLogModel.countDocuments({
          action: AuditAction.ACCOUNT_PASSWORD_RESET,
          targetId: id,
        }),
      ).resolves.toBe(1);

      await login(TRAVELER, PASSWORD).expect(401);
      const loginResponse = await login(TRAVELER, 'Temp2026pass').expect(200);
      expect(loginResponse.body.mustChangePassword).toBe(true);
      const traveler = cookiesOf(loginResponse);

      // Only /auth/me and change-password are open until the change.
      await request(server())
        .get('/api/auth/me')
        .set('Cookie', traveler)
        .expect(200);
      const blocked = await request(server())
        .get('/api/users/me')
        .set('Cookie', traveler)
        .expect(403);
      expect(blocked.body.message).toBe(
        'You must change your temporary password before continuing.',
      );

      await request(server())
        .patch('/api/auth/change-password')
        .set('Cookie', traveler)
        .send({ currentPassword: 'Temp2026pass', newPassword: 'mine2027pass' })
        .expect(204);
      const profile = await request(server())
        .get('/api/users/me')
        .set('Cookie', traveler)
        .expect(200);
      expect(profile.body.mustChangePassword).toBe(false);
    });

    it('rejects a temporary password that breaks the rules', async () => {
      const id = await travelerId();

      await adminCall('post', `/api/admin/users/${id}/reset-password`)
        .send({ temporaryPassword: 'short' })
        .expect(400);
      await login(TRAVELER, PASSWORD).expect(200);
    });
  });
});
