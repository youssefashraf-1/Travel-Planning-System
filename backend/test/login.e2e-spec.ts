import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { AuthModule } from '../src/auth/auth.module';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import {
  User,
  UserDocument,
  UserStatus,
} from '../src/users/schemas/user.schema';

/** Test-only protected route, standing in for /api/auth/me until it exists. */
@Controller('e2e-probe')
class ProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  whoAmI(@CurrentUser() user: UserDocument) {
    return { id: user._id.toString(), email: user.email };
  }
}

// All test accounts use this domain so cleanup never touches other records.
const TEST_DOMAIN = 'acc04.e2e.test';
const EMAIL = `mona@${TEST_DOMAIN}`;
const PASSWORD = 'travel2026';

describe('POST /api/auth/login (ACC-04, ACC-05, e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;

  const cleanUp = () =>
    userModel.deleteMany({ email: new RegExp(`@${TEST_DOMAIN}$`) });

  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });

  const accessCookie = (response: request.Response) =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .find((cookie) => cookie.startsWith('access_token='));

  const probe = (cookie?: string) => {
    const call = request(app.getHttpServer()).get('/api/e2e-probe');
    return cookie ? call.set('Cookie', cookie.split(';')[0]) : call;
  };

  const storedUser = () => userModel.findOne({ email: EMAIL }).lean();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    userModel = app.get(getModelToken(User.name));
    await userModel.init();
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

  it('logs in and sets the JWT only in a secure HttpOnly cookie', async () => {
    const response = await login(EMAIL, PASSWORD).expect(200);

    expect(response.body).toMatchObject({
      email: EMAIL,
      role: 'traveler',
      status: 'active',
      mustChangePassword: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/token|passwordHash/i);

    const cookie = accessCookie(response);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/Max-Age=900/);
  });

  it('accepts the email in any letter case', async () => {
    await login(EMAIL.toUpperCase(), PASSWORD).expect(200);
  });

  it('lets the cookie open a protected route', async () => {
    const cookie = accessCookie(await login(EMAIL, PASSWORD).expect(200));

    const response = await probe(cookie).expect(200);
    expect(response.body.email).toBe(EMAIL);
  });

  it('rejects protected routes without a valid cookie', async () => {
    await probe().expect(401);
    await probe('access_token=not.a.jwt').expect(401);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await login(EMAIL, 'wrong2026').expect(401);
    const unknownEmail = await login(`nobody@${TEST_DOMAIN}`, PASSWORD).expect(
      401,
    );

    expect(wrongPassword.body.message).toBe('Invalid email or password.');
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    expect(accessCookie(wrongPassword)).toBeUndefined();
  });

  it('returns 400 for a missing password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL })
      .expect(400);
  });

  it('locks the account for 15 minutes after five wrong passwords', async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await login(EMAIL, 'wrong2026').expect(401);
    }
    const fifth = await login(EMAIL, 'wrong2026').expect(423);
    expect(fifth.body.message).toBe(
      'Too many failed login attempts. Try again in 15 minute(s).',
    );

    // Even the right password is refused while locked.
    await login(EMAIL, PASSWORD).expect(423);

    const locked = await storedUser();
    const lockMinutes = (locked!.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(lockMinutes).toBeGreaterThan(14);
    expect(lockMinutes).toBeLessThanOrEqual(15);

    // Once the lock time has passed, the right password works again.
    await userModel.updateOne(
      { email: EMAIL },
      { lockedUntil: new Date(Date.now() - 1000) },
    );
    await login(EMAIL, PASSWORD).expect(200);
    const unlocked = await storedUser();
    expect(unlocked?.failedLoginAttempts).toBe(0);
    expect(unlocked?.lockedUntil).toBeUndefined();
  });

  it('resets the failure count after a successful login', async () => {
    await login(EMAIL, 'wrong2026').expect(401);
    await login(EMAIL, 'wrong2026').expect(401);
    expect((await storedUser())?.failedLoginAttempts).toBe(2);

    await login(EMAIL, PASSWORD).expect(200);
    expect((await storedUser())?.failedLoginAttempts).toBe(0);
  });

  it('counts simultaneous wrong passwords without losing any', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => login(EMAIL, 'wrong2026')),
    );

    expect(responses.some((response) => response.status === 423)).toBe(true);
    const user = await storedUser();
    expect(user?.lockedUntil).toBeInstanceOf(Date);
  });

  it('blocks suspended accounts at login and on existing sessions', async () => {
    const cookie = accessCookie(await login(EMAIL, PASSWORD).expect(200));
    await userModel.updateOne(
      { email: EMAIL },
      { status: UserStatus.SUSPENDED },
    );

    const response = await login(EMAIL, PASSWORD).expect(403);
    expect(response.body.message).toBe('This account is suspended.');
    await probe(cookie).expect(403);
  });
});
