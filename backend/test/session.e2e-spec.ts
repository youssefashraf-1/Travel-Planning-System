import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { AuthModule } from '../src/auth/auth.module';
import { Session } from '../src/auth/schemas/session.schema';
import { User } from '../src/users/schemas/user.schema';
import { E2eProbeController } from './support/e2e-probe.controller';

// All test accounts use this domain so cleanup never touches other records.
const TEST_DOMAIN = 'acc06.e2e.test';
const EMAIL = `mona@${TEST_DOMAIN}`;
const PASSWORD = 'travel2026';

interface Cookies {
  access: string;
  refresh: string;
}

describe('Sessions, refresh and logout (ACC-06, ACC-19, e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;

  const setCookies = (response: request.Response) =>
    ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const cookieNamed = (response: request.Response, name: string) =>
    setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
  const valueOf = (cookie: string | undefined) => cookie!.split(';')[0];

  const login = async (): Promise<Cookies> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    return {
      access: valueOf(cookieNamed(response, 'access_token')),
      refresh: valueOf(cookieNamed(response, 'refresh_token')),
    };
  };

  const probe = (cookie: string) =>
    request(app.getHttpServer()).get('/api/e2e-probe').set('Cookie', cookie);
  const refresh = (cookie: string) =>
    request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookie);
  const logout = (cookies: string[] = []) =>
    request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookies.join('; '));

  const sessionsOfUser = async () => {
    const user = await userModel.findOne({ email: EMAIL });
    return sessionModel.find({ userId: user!._id }).lean();
  };

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
      imports: [AppModule, AuthModule],
      controllers: [E2eProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    await userModel.init();
    await sessionModel.init();
  });

  beforeEach(async () => {
    await cleanUp();
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Mona Hassan',
        email: EMAIL,
        password: PASSWORD,
        acceptTermsAndPrivacy: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  describe('login', () => {
    it('sets a secure HttpOnly refresh cookie limited to /api/auth', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      const cookie = cookieNamed(response, 'refresh_token');
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/auth/);
      expect(JSON.stringify(response.body)).not.toMatch(/token/i);
    });

    it('stores a 30-minute session with only a digest of the refresh token', async () => {
      const cookies = await login();
      const [session] = await sessionsOfUser();
      const refreshToken = cookies.refresh.split('=')[1];

      expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(session)).not.toContain(refreshToken);
      const minutesLeft = (session.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutesLeft).toBeGreaterThan(29);
      expect(minutesLeft).toBeLessThanOrEqual(30);
      expect(session.revokedAt).toBeUndefined();
    });
  });

  describe('session expiry (ACC-19)', () => {
    it('restarts the 30-minute window on each authenticated request', async () => {
      const cookies = await login();
      await sessionModel.updateMany(
        {},
        { expiresAt: new Date(Date.now() + 60_000) },
      );

      await probe(cookies.access).expect(200);

      const [session] = await sessionsOfUser();
      const minutesLeft = (session.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutesLeft).toBeGreaterThan(29);
    });

    it('ends the session after 30 minutes without activity', async () => {
      const cookies = await login();
      const user = await userModel.findOne({ email: EMAIL });
      await sessionModel.updateMany(
        { userId: user!._id },
        { expiresAt: new Date(Date.now() - 1000) },
      );

      const response = await probe(cookies.access).expect(401);
      expect(response.body.message).toBe(
        'Your session has expired. Please log in again.',
      );
      await refresh(cookies.refresh).expect(401);
    });
  });

  describe('refresh', () => {
    it('issues new cookies and keeps the session open', async () => {
      const cookies = await login();

      const response = await refresh(cookies.refresh).expect(200);
      expect(response.body.email).toBe(EMAIL);

      const newAccess = valueOf(cookieNamed(response, 'access_token'));
      const newRefresh = valueOf(cookieNamed(response, 'refresh_token'));
      expect(newRefresh).not.toBe(cookies.refresh);
      await probe(newAccess).expect(200);
      expect(await sessionsOfUser()).toHaveLength(1);
    });

    it('accepts each refresh token only once', async () => {
      const cookies = await login();
      await refresh(cookies.refresh).expect(200);

      await refresh(cookies.refresh).expect(401);
    });

    it('returns 401 without a refresh cookie', async () => {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    });
  });

  describe('logout (ACC-06)', () => {
    it('revokes the session on the server and clears both cookies', async () => {
      const cookies = await login();

      const response = await logout([cookies.access, cookies.refresh]).expect(
        204,
      );

      for (const name of ['access_token', 'refresh_token']) {
        expect(cookieNamed(response, name)).toMatch(/Expires=Thu, 01 Jan 1970/);
      }
      const [session] = await sessionsOfUser();
      expect(session.revokedAt).toBeInstanceOf(Date);

      // Copies of the old cookies no longer work.
      await probe(cookies.access).expect(401);
      await refresh(cookies.refresh).expect(401);
    });

    it('ends only this browser, not other sessions of the same user', async () => {
      const laptop = await login();
      const phone = await login();

      await logout([laptop.access, laptop.refresh]).expect(204);

      await probe(laptop.access).expect(401);
      await probe(phone.access).expect(200);
    });

    it('still revokes the session when only the refresh cookie is sent', async () => {
      const cookies = await login();

      await logout([cookies.refresh]).expect(204);

      await probe(cookies.access).expect(401);
    });

    it('is harmless without any session', async () => {
      await logout().expect(204);
    });
  });
});
