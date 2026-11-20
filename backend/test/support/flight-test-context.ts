import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app/app.module';
import { configureApp } from '../../src/app/configure-app';
import { Airline } from '../../src/airlines/schemas/airline.schema';
import { Airport } from '../../src/airports/schemas/airport.schema';
import { PasswordHasherService } from '../../src/auth/password-hasher.service';
import { Session } from '../../src/auth/schemas/session.schema';
import { User, UserRole } from '../../src/users/schemas/user.schema';

/** Real login and models, restricted by setup-e2e to the test database. */
export async function flightTestContext(tag: string) {
  const fixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = fixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  const users = app.get<Model<User>>(getModelToken(User.name));
  const airlines = app.get<Model<Airline>>(getModelToken(Airline.name));
  const airports = app.get<Model<Airport>>(getModelToken(Airport.name));
  const sessions = app.get<Model<Session>>(getModelToken(Session.name));
  await Promise.all([users.init(), airlines.init(), airports.init()]);
  const suffix = new Types.ObjectId().toString();
  const airline = await airlines.create({
    name: 'Test Airline',
    code: `T-${suffix.slice(-8)}`,
  });
  const other = await airlines.create({
    name: 'Other Airline',
    code: `O-${suffix.slice(-8)}`,
  });
  const airlineIds = [airline._id, other._id];
  const airportIds: Types.ObjectId[] = [];
  const userIds: Types.ObjectId[] = [];
  const cookies: Record<string, string[]> = {};
  const passwordHash = await app
    .get(PasswordHasherService)
    .hash('TestPassword2026');
  for (const [name, role, provider] of [
    ['admin', UserRole.ADMIN],
    ['traveler', UserRole.TRAVELER],
    ['moderator', UserRole.AIRLINE_MODERATOR, airline._id],
    ['other', UserRole.AIRLINE_MODERATOR, other._id],
    ['hotel', UserRole.HOTEL_MODERATOR, new Types.ObjectId()],
  ] as const) {
    const user = await users.create({
      name,
      email: `${name}-${suffix}@${tag}.e2e.test`,
      role,
      passwordHash,
      assignedProviderId: provider,
    });
    userIds.push(user._id);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: user.email, password: 'TestPassword2026' })
      .expect(200);
    cookies[name] = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((v) => v.split(';')[0]);
  }
  return {
    app,
    users,
    airlines,
    airports,
    airline,
    other,
    airlineIds,
    airportIds,
    cookies,
    async cleanUp() {
      await sessions.deleteMany({ userId: { $in: userIds } });
      await users.deleteMany({ _id: { $in: userIds } });
      await airlines.deleteMany({ _id: { $in: airlineIds } });
      await airports.deleteMany({ _id: { $in: airportIds } });
      await app.close();
    },
  };
}
