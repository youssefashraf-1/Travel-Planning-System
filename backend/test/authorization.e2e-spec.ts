import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import {
  assertManagesProvider,
  assertOwnedBy,
  ProviderType,
} from '../src/auth/access';
import { AuthModule } from '../src/auth/auth.module';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';
import { ManagesProvider } from '../src/auth/decorators/manages-provider.decorator';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { ProviderOwnerGuard } from '../src/auth/guards/provider-owner.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { Session } from '../src/auth/schemas/session.schema';
import {
  User,
  UserRole,
  type UserDocument,
} from '../src/users/schemas/user.schema';

// Sample routes written the way feature modules will use the guards.
const airlineId = new Types.ObjectId();
const otherAirlineId = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const flights = new Map([
  ['f1', { airlineId }],
  ['f2', { airlineId: otherAirlineId }],
]);
let bookingOwnerId: Types.ObjectId;

@Controller('access-check')
@UseGuards(JwtAuthGuard, RolesGuard, ProviderOwnerGuard)
class AccessCheckController {
  @Get('admin-only')
  @Roles(UserRole.ADMIN)
  adminOnly() {
    return { ok: true };
  }

  @Get('airlines/:id')
  @ManagesProvider(ProviderType.AIRLINE)
  airline(@Param('id') id: string) {
    return { ok: true, id };
  }

  @Get('flights/:id')
  flight(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    const flight = flights.get(id);
    if (!flight) {
      throw new NotFoundException('Flight not found.');
    }
    assertManagesProvider(user, ProviderType.AIRLINE, flight.airlineId);
    return { ok: true };
  }

  @Get('booking')
  booking(@CurrentUser() user: UserDocument) {
    assertOwnedBy(user, bookingOwnerId, 'Booking not found.');
    return { ok: true };
  }
}

const TEST_DOMAIN = 'authz.e2e.test';
const PASSWORD = 'travel2026';

describe('Authorization rules (ACC-11, moderator ownership, e2e)', () => {
  let app: INestApplication<App>;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;
  const cookies: Record<string, string[]> = {};

  const cleanUp = async () => {
    const ids = (
      await userModel.find({ email: new RegExp(`@${TEST_DOMAIN}$`) })
    ).map((user) => user._id);
    await sessionModel.deleteMany({ userId: { $in: ids } });
    await userModel.deleteMany({ _id: { $in: ids } });
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, AuthModule],
      controllers: [AccessCheckController],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    userModel = app.get(getModelToken(User.name));
    sessionModel = app.get(getModelToken(Session.name));
    await cleanUp();

    const passwordHash = await app.get(PasswordHasherService).hash(PASSWORD);
    const accounts = {
      admin: { role: UserRole.ADMIN },
      traveler: { role: UserRole.TRAVELER },
      otherTraveler: { role: UserRole.TRAVELER },
      airlineModerator: {
        role: UserRole.AIRLINE_MODERATOR,
        assignedProviderId: airlineId,
      },
      otherAirlineModerator: {
        role: UserRole.AIRLINE_MODERATOR,
        assignedProviderId: otherAirlineId,
      },
      hotelModerator: {
        role: UserRole.HOTEL_MODERATOR,
        assignedProviderId: hotelId,
      },
    };
    for (const [name, fields] of Object.entries(accounts)) {
      const user = await userModel.create({
        name,
        email: `${name.toLowerCase()}@${TEST_DOMAIN}`,
        passwordHash,
        ...fields,
      });
      if (name === 'traveler') {
        bookingOwnerId = user._id;
      }
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      cookies[name] = ([] as string[])
        .concat(response.headers['set-cookie'] ?? [])
        .map((cookie) => cookie.split(';')[0]);
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  const get = (path: string, as?: string) => {
    const call = request(app.getHttpServer()).get(`/api/access-check/${path}`);
    return as ? call.set('Cookie', cookies[as]) : call;
  };

  it('asks for login before checking anything else', async () => {
    await get('admin-only').expect(401);
    await get(`airlines/${airlineId.toString()}`).expect(401);
  });

  it('limits role routes to that role', async () => {
    await get('admin-only', 'admin').expect(200);
    for (const name of ['traveler', 'airlineModerator', 'hotelModerator']) {
      await get('admin-only', name).expect(403);
    }
  });

  it('lets only the airline’s own moderator use an airline route', async () => {
    const path = `airlines/${airlineId.toString()}`;

    await get(path, 'airlineModerator').expect(200);
    const other = await get(path, 'otherAirlineModerator').expect(403);
    expect(other.body.message).toBe('You can only manage your own airline.');
    for (const name of ['admin', 'traveler', 'hotelModerator']) {
      await get(path, name).expect(403);
    }
    await get('airlines/not-an-id', 'airlineModerator').expect(404);
  });

  it('checks the airline behind a flight', async () => {
    await get('flights/f1', 'airlineModerator').expect(200);
    await get('flights/f2', 'airlineModerator').expect(403);
    await get('flights/f2', 'otherAirlineModerator').expect(200);
    await get('flights/none', 'airlineModerator').expect(404);
  });

  it('shows a booking only to its owner; others get 404', async () => {
    await get('booking', 'traveler').expect(200);
    const other = await get('booking', 'otherTraveler').expect(404);
    expect(other.body.message).toBe('Booking not found.');
    await get('booking', 'admin').expect(404);
  });
});
