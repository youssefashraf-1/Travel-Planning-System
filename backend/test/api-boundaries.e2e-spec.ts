import { writeFileSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import {
  DocumentBuilder,
  OpenAPIObject,
  OperationObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp, setupSwagger } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { Session } from '../src/auth/schemas/session.schema';
import { User, UserRole } from '../src/users/schemas/user.schema';

const PUBLIC = new Set([
  'get /',
  'get /api/airports',
  'get /api/airlines/{id}',
  'get /api/flights/search',
  'get /api/flights/{id}',
  'get /api/hotels/search',
  'get /api/hotels/{id}',
  'get /api/hotels/{id}/rooms/available',
  'get /api/hotels/{id}/reviews',
  'get /api/posts',
  'get /api/posts/search',
  'get /api/posts/{id}',
  'get /api/posts/{id}/comments',
  'get /api/tags/{tag}/posts',
  'get /api/authors/{id}',
  'get /api/itineraries/public/search',
  'get /api/itineraries/public/{id}',
  'post /api/auth/register',
  'post /api/auth/login',
  'post /api/auth/logout',
  // Called by Stripe; protected by its signature instead of a login.
  'post /api/payments/webhook',
]);
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
const METHODS: Method[] = ['get', 'post', 'patch', 'put', 'delete'];
const ID = '000000000000000000000001';
const examplePath = (path: string) =>
  path.replace(/\{([^}]+)\}/g, (_whole, parameter: string) =>
    parameter === 'type' ? 'airline' : ID,
  );

/** Tests the HTTP boundaries of every documented business route, independently of its guard annotations. */
describe('Phase 13 whole-API access boundaries', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  let users: Model<User>;
  let user: User & { id: string };
  let cookies: string[];
  let routes: { method: Method; path: string; operation: OperationObject }[];
  const results: { method: Method; path: string; guestStatus: number }[] = [];
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication({ rawBody: true });
    app.useLogger(false);
    configureApp(app);
    setupSwagger(app);
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addCookieAuth('access_token').build(),
    );
    routes = Object.entries(document.paths).flatMap(([path, item]) =>
      METHODS.flatMap((method) =>
        item[method]
          ? [{ method, path, operation: item[method] as OperationObject }]
          : [],
      ),
    );
    users = app.get(getModelToken(User.name));
    user = await users.create({
      name: 'Phase13 Boundary Traveler',
      email: 'phase13.boundary@example.invalid',
      role: UserRole.TRAVELER,
      passwordHash: await app
        .get(PasswordHasherService)
        .hash('Phase13Test2026!'),
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Phase13Test2026!' })
      .expect(200);
    cookies = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((c) => c.split(';')[0]);
  });
  afterAll(async () => {
    if (user) {
      await app
        .get<Model<Session>>(getModelToken(Session.name))
        .deleteMany({ userId: user.id });
      await users.deleteOne({ _id: user.id });
    }
    if (app) await app.close();
    if (process.env.PHASE13_API_REPORT)
      writeFileSync(
        process.env.PHASE13_API_REPORT,
        JSON.stringify(
          {
            totalOperations: routes.length,
            publicOperations: PUBLIC.size,
            protectedOperations: routes.length - PUBLIC.size,
            results,
          },
          null,
          2,
        ),
      );
  });
  it('requires login on every non-public route, with consistent error responses', async () => {
    for (const route of routes.filter(
      (r) => !PUBLIC.has(`${r.method} ${r.path}`),
    )) {
      const response = await request(app.getHttpServer())
        [route.method](examplePath(route.path))
        .send({});
      expect({
        route: `${route.method} ${route.path}`,
        status: response.status,
      }).toEqual({ route: `${route.method} ${route.path}`, status: 401 });
      expect(response.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        message: expect.any(String),
      });
      expect(response.body).not.toHaveProperty('stack');
      expect(route.operation.security?.length).toBeGreaterThan(0);
      results.push({
        method: route.method,
        path: route.path,
        guestStatus: response.status,
      });
    }
  });
  it('keeps precisely the intended public routes reachable without login', async () => {
    for (const key of PUBLIC) {
      const route = routes.find((r) => `${r.method} ${r.path}` === key);
      expect(route).toBeDefined();
      const response = await request(app.getHttpServer())
        [route!.method](examplePath(route!.path))
        .send({});
      expect({
        route: key,
        allowed: [200, 204, 400, 404].includes(response.status),
      }).toEqual({ route: key, allowed: true });
      results.push({
        method: route!.method,
        path: route!.path,
        guestStatus: response.status,
      });
    }
  });
  it('rejects a traveler on every administrator operation before input validation or side effects', async () => {
    for (const route of routes.filter(
      (r) =>
        r.path.startsWith('/api/admin/') ||
        (r.method === 'post' &&
          ['/api/airlines', '/api/hotels'].includes(r.path)),
    )) {
      const response = await request(app.getHttpServer())
        [route.method](examplePath(route.path))
        .set('Cookie', cookies)
        .send({});
      expect({
        route: `${route.method} ${route.path}`,
        status: response.status,
      }).toEqual({ route: `${route.method} ${route.path}`, status: 403 });
      expect(response.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
      });
    }
  });
  it('requires explicit confirmation on all older destructive delete routes', async () => {
    for (const path of [
      `/api/itineraries/${ID}`,
      `/api/itineraries/${ID}/days/${ID}`,
      `/api/activities/${ID}`,
      `/api/activities/${ID}/images/${ID}`,
      `/api/budgets/${ID}`,
      `/api/transport-costs/${ID}`,
      `/api/reviews/${ID}`,
    ]) {
      for (const body of [
        {},
        { confirm: false },
        { confirm: 'true' },
        { confirm: null },
        { confirm: true, unexpected: true },
      ]) {
        await request(app.getHttpServer())
          .delete(path)
          .set('Cookie', cookies)
          .send(body)
          .expect(400);
      }
      await request(app.getHttpServer())
        .delete(path)
        .set('Cookie', cookies)
        .send({ confirm: true })
        .expect(404);
    }
  });
  it('serves Swagger and documents the Stripe webhook, which rejects unsigned requests', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    const json = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(Object.keys(json.paths).sort()).toEqual(
      Object.keys(document.paths).sort(),
    );
    expect(document.paths['/api/payments/webhook']).toBeDefined();
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .send({ type: 'payment_intent.succeeded' })
      .expect(400);
  });
});
