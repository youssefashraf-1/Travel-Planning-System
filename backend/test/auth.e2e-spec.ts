import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp, setupSwagger } from '../src/app/configure-app';
import { User, UserRole } from '../src/users/schemas/user.schema';

// All test accounts use this domain so cleanup never touches other records.
const TEST_DOMAIN = 'acc01.e2e.test';
const emailFor = (name: string) => `${name}@${TEST_DOMAIN}`;

const validBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Mona Hassan',
  email: emailFor('mona'),
  password: 'travel2026',
  acceptTermsAndPrivacy: true,
  ...overrides,
});

describe('POST /api/auth/register (ACC-01, e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;

  const cleanUp = () =>
    userModel.deleteMany({ email: new RegExp(`@${TEST_DOMAIN}$`) });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    userModel = app.get(getModelToken(User.name));
    // Make sure the unique email index exists before testing duplicates.
    await userModel.init();
  });

  beforeEach(cleanUp);

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  const register = (body: object) =>
    request(app.getHttpServer()).post('/api/auth/register').send(body);

  it('creates a traveler and returns only safe account fields', async () => {
    const response = await register(
      validBody({ name: '  Mona Hassan ', email: ' Mona@ACC01.E2E.Test ' }),
    ).expect(201);

    expect(Object.keys(response.body).sort()).toEqual(
      [
        'createdAt',
        'email',
        'id',
        'mustChangePassword',
        'name',
        'role',
        'status',
      ].sort(),
    );
    expect(response.body).toMatchObject({
      name: 'Mona Hassan',
      email: emailFor('mona'),
      role: UserRole.TRAVELER,
      status: 'active',
    });

    const stored = await userModel
      .findById(response.body.id)
      .select('+passwordHash')
      .lean();
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain('travel2026');
    expect(stored?.termsAndPrivacyAcceptedAt).toBeInstanceOf(Date);
    expect(stored?.mustChangePassword).toBe(false);
    expect(stored?.failedLoginAttempts).toBe(0);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await register(validBody()).expect(201);

    const response = await register(
      validBody({ email: emailFor('MONA').toUpperCase() }),
    ).expect(409);
    expect(response.body.message).toBe(
      'An account with this email already exists.',
    );
  });

  it('lets only one of several simultaneous registrations succeed', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => register(validBody())),
    );

    const statuses = responses
      .map((response) => response.status)
      .sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    await expect(
      userModel.countDocuments({ email: emailFor('mona') }),
    ).resolves.toBe(1);
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }],
    ['a short password', { password: 'trip26' }],
    ['a password without a digit', { password: 'travelling' }],
    ['a password without a letter', { password: '12345678' }],
    ['refused consent', { acceptTermsAndPrivacy: false }],
    ['missing consent', { acceptTermsAndPrivacy: undefined }],
    ['a client-chosen admin role', { role: UserRole.ADMIN }],
  ])('returns 400 for %s and saves nothing', async (_case, override) => {
    await register(validBody(override)).expect(400);

    await expect(
      userModel.countDocuments({ email: new RegExp(`@${TEST_DOMAIN}$`) }),
    ).resolves.toBe(0);
  });

  it('keeps GET / outside the /api prefix', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('documents the endpoint in Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(response.body.paths['/api/auth/register'].post).toBeDefined();
  });
});
