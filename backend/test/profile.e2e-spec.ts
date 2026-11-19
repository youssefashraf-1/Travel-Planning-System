import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { Session } from '../src/auth/schemas/session.schema';
import { Currency } from '../src/reference-data/schemas/currency.schema';
import { User } from '../src/users/schemas/user.schema';

// All test accounts use this domain so cleanup never touches other records.
const TEST_DOMAIN = 'acc09.e2e.test';
const EMAIL = `mona@${TEST_DOMAIN}`;
const PASSWORD = 'travel2026';

describe('/api/auth/me and /api/users/me (ACC-09, ACC-11, ACC-19, e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  let cookies: string[];

  const server = () => app.getHttpServer();
  const storedUser = () => userModel.findOne({ email: EMAIL }).lean();
  const patchProfile = (body: object) =>
    request(server()).patch('/api/users/me').set('Cookie', cookies).send(body);

  const cleanUp = async () => {
    const users = await userModel.find({
      email: new RegExp(`@${TEST_DOMAIN}$`),
    });
    const ids = users.map((user) => user._id);
    await sessionModel.deleteMany({ userId: { $in: ids } });
    await userModel.deleteMany({ _id: { $in: ids } });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    await userModel.init();

    // The test database needs the supported currencies the seed provides.
    const currencyModel = app.get<Model<Currency>>(
      getModelToken(Currency.name),
    );
    for (const code of ['EGP', 'USD']) {
      await currencyModel.updateOne(
        { _id: code },
        { _id: code },
        { upsert: true },
      );
    }
  });

  beforeEach(async () => {
    await cleanUp();
    await request(server())
      .post('/api/auth/register')
      .send({
        name: 'Mona Hassan',
        email: EMAIL,
        password: PASSWORD,
        acceptTermsAndPrivacy: true,
      })
      .expect(201);
    const login = await request(server())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    cookies = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0]);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('GET /api/auth/me (ACC-19)', () => {
    it('returns the signed-in account from the cookies alone', async () => {
      const response = await request(server())
        .get('/api/auth/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        email: EMAIL,
        name: 'Mona Hassan',
        role: 'traveler',
        status: 'active',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|token/i);
    });

    it('returns 401 without cookies and after logout', async () => {
      await request(server()).get('/api/auth/me').expect(401);

      await request(server())
        .post('/api/auth/logout')
        .set('Cookie', cookies)
        .expect(204);
      await request(server())
        .get('/api/auth/me')
        .set('Cookie', cookies)
        .expect(401);
    });
  });

  describe('GET /api/users/me (ACC-11)', () => {
    it('returns my own profile', async () => {
      const response = await request(server())
        .get('/api/users/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.email).toBe(EMAIL);
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('returns 401 when not logged in', async () => {
      await request(server()).get('/api/users/me').expect(401);
    });
  });

  describe('PATCH /api/users/me (ACC-09)', () => {
    it('updates name, phone and preferred currency', async () => {
      const response = await patchProfile({
        name: 'Mona H.',
        phone: '+20 100 123 4567',
        preferredCurrency: 'egp',
      }).expect(200);

      expect(response.body).toMatchObject({
        name: 'Mona H.',
        phone: '+20 100 123 4567',
        preferredCurrency: 'EGP',
      });
      expect(await storedUser()).toMatchObject({
        name: 'Mona H.',
        phone: '+20 100 123 4567',
        preferredCurrency: 'EGP',
      });
    });

    it('saves nothing when the currency is not supported', async () => {
      const response = await patchProfile({
        name: 'Changed Name',
        preferredCurrency: 'XYZ',
      }).expect(400);

      expect(response.body.message).toBe(
        'preferredCurrency XYZ is not a supported currency',
      );
      expect((await storedUser())?.name).toBe('Mona Hassan');
    });

    it('saves nothing when the phone is invalid', async () => {
      await patchProfile({ name: 'Changed Name', phone: 'call me' }).expect(
        400,
      );

      expect((await storedUser())?.name).toBe('Mona Hassan');
    });

    it('removes phone and currency with null', async () => {
      await patchProfile({
        phone: '+20 100 123 4567',
        preferredCurrency: 'USD',
      }).expect(200);

      const response = await patchProfile({
        phone: null,
        preferredCurrency: null,
      }).expect(200);

      expect(response.body).not.toHaveProperty('phone');
      const user = await storedUser();
      expect(user?.phone).toBeUndefined();
      expect(user?.preferredCurrency).toBeUndefined();
    });

    it.each([
      ['email', { email: `other@${TEST_DOMAIN}` }],
      ['role', { role: 'admin' }],
      ['status', { status: 'active' }],
    ])('refuses to change %s', async (_field, body) => {
      await patchProfile(body).expect(400);

      expect(await storedUser()).toMatchObject({
        email: EMAIL,
        role: 'traveler',
      });
    });

    it('rejects an empty update', async () => {
      await patchProfile({}).expect(400);
    });

    it('returns 401 when not logged in', async () => {
      await request(server())
        .patch('/api/users/me')
        .send({ name: 'Intruder' })
        .expect(401);
    });
  });
});
