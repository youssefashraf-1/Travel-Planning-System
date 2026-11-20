import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import {
  ImageUploadsService,
  MAX_IMAGE_BYTES,
} from '../src/common/uploads/image-uploads.service';
import { NotificationType } from '../src/notifications/schemas/notification.schema';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const PASSWORD = 'Phase12Test2026!';
const TAG = 'phase12.support.test';

describe('Phase 12 notifications and provider media', () => {
  let app: INestApplication<App>;
  const m: Record<string, Model<any>> = {};
  const ids: Record<string, Types.ObjectId> = {};
  const cookies: Record<string, string[]> = {};
  const airline = new Types.ObjectId(),
    hotel = new Types.ObjectId();
  const uploadsDir = mkdtempSync(join(tmpdir(), 'phase12-support-'));
  const previousUploads = process.env.UPLOADS_DIR;
  let notifications: string[];
  const call = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const r = request(app.getHttpServer())[method]('/api' + path);
    return who ? r.set('Cookie', cookies[who]) : r;
  };
  const photo = (who = 'hotelMod', data = PNG) =>
    call('post', `/hotels/${hotel.toString()}/photos`, who).attach(
      'image',
      data,
      'image.png',
    );
  const logo = (who = 'airMod', data = PNG) =>
    call('put', `/airlines/${airline.toString()}/logo`, who).attach(
      'image',
      data,
      'image.png',
    );
  const filePath = (url: string) =>
    join(uploadsDir, url.slice('/uploads/'.length));
  const files = (folder: string) =>
    existsSync(join(uploadsDir, folder))
      ? readdirSync(join(uploadsDir, folder))
      : [];

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
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
      'Hotel',
      'Notification',
    ]) {
      m[name] = app.get(getModelToken(name));
      await m[name].init();
    }
    await m.Airline.create({
      _id: airline,
      name: 'Phase12 Media Airline',
      code: 'P12MEDIA',
    });
    await m.Hotel.create({
      _id: hotel,
      name: 'Phase12 Media Hotel',
      address: 'Test Road',
      cityId: 'phase12-support-city',
      countryCode: 'QZ',
      timeZone: 'Africa/Cairo',
      description: 'Media test',
      starClass: 4,
    });
    const passwordHash = await app.get(PasswordHasherService).hash(PASSWORD);
    for (const [name, role, assignedProviderId] of [
      ['traveler', 'traveler', undefined],
      ['other', 'traveler', undefined],
      ['admin', 'admin', undefined],
      ['airMod', 'airline_moderator', airline],
      ['hotelMod', 'hotel_moderator', hotel],
      ['otherAirMod', 'airline_moderator', new Types.ObjectId()],
      ['otherHotelMod', 'hotel_moderator', new Types.ObjectId()],
    ] as const) {
      const user = await m.User.create({
        name,
        email: `${name}@${TAG}`,
        passwordHash,
        role,
        assignedProviderId,
      });
      ids[name] = user._id;
      const login = await call('post', '/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      cookies[name] = ([] as string[])
        .concat(login.headers['set-cookie'] ?? [])
        .map((c) => c.split(';')[0]);
    }
  });
  beforeEach(async () => {
    await m.User.updateMany(
      { _id: { $in: Object.values(ids) } },
      { $set: { status: 'active', mustChangePassword: false } },
    );
    await m.Notification.deleteMany({
      recipientId: { $in: Object.values(ids) },
    });
    const types = Object.values(NotificationType);
    const subjects = [
      'FlightBooking',
      'HotelBooking',
      'Refund',
      'Flight',
      'User',
      'Airline',
    ];
    const rows = await m.Notification.create(
      Array.from({ length: 12 }, (_, i) => ({
        recipientId: ids.traveler,
        type: types[i % types.length],
        subjectModel: subjects[i % types.length],
        subjectId: new Types.ObjectId(),
        title: `Notice ${i}`,
        message: `Event ${i}`,
        eventKey: `phase12-${i}`,
        readAt: i < 2 ? new Date('2026-01-02') : null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    );
    notifications = rows.map((row) => row.id as string);
    await m.Notification.create({
      recipientId: ids.other,
      type: 'account_status_changed',
      subjectModel: 'User',
      subjectId: ids.other,
      title: 'Private notice',
      message: 'Other recipient only',
      eventKey: 'other',
    });
    await m.Hotel.updateOne({ _id: hotel }, { $set: { photos: [] } });
    await m.Airline.updateOne({ _id: airline }, { $unset: { logoUrl: 1 } });
    for (const folder of ['hotels', 'airlines'])
      rmSync(join(uploadsDir, folder), { recursive: true, force: true });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (m.User) {
      await m.Notification.deleteMany({
        recipientId: { $in: Object.values(ids) },
      });
      await m.Session.deleteMany({ userId: { $in: Object.values(ids) } });
      await m.User.deleteMany({ _id: { $in: Object.values(ids) } });
      await m.Hotel.deleteOne({ _id: hotel });
      await m.Airline.deleteOne({ _id: airline });
    }
    if (app) await app.close();
    if (previousUploads === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploads;
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('requires login on all notification endpoints', async () => {
    await call('get', '/notifications').expect(401);
    await call('get', '/notifications/unread-count').expect(401);
    await call('patch', '/notifications/read-all').expect(401);
    await call('patch', `/notifications/${notifications[2]}/read`).expect(401);
  });
  it('lists only own notifications newest first, paginates and exposes all six event types', async () => {
    const a = (await call('get', '/notifications', 'traveler').expect(200))
      .body;
    const b = (
      await call('get', '/notifications?page=2', 'traveler').expect(200)
    ).body;
    expect(a).toMatchObject({
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
      unreadCount: 10,
    });
    expect(a.items.map((x: { id: string }) => x.id)).toEqual(
      [...notifications].reverse().slice(0, 10),
    );
    expect(b.items.map((x: { id: string }) => x.id)).toEqual([
      notifications[1],
      notifications[0],
    ]);
    expect(new Set(a.items.map((x: { type: string }) => x.type))).toEqual(
      new Set(Object.values(NotificationType)),
    );
    expect(JSON.stringify(a)).not.toMatch(
      /recipientId|eventKey|Private notice|password/,
    );
    expect(
      (await call('get', '/notifications/unread-count', 'traveler')).body
        .unreadCount,
    ).toBe(10);
  });
  it('filters read/unread without changing the global unread count or marking on view', async () => {
    const unread = (await call('get', '/notifications?unread=true', 'traveler'))
      .body;
    const read = (await call('get', '/notifications?unread=false', 'traveler'))
      .body;
    expect(unread.totalItems).toBe(10);
    expect(read.totalItems).toBe(2);
    expect(read.unreadCount).toBe(10);
    expect(
      unread.items.every((x: { readAt: unknown }) => x.readAt === null),
    ).toBe(true);
    expect(
      (await call('get', '/notifications/unread-count', 'traveler')).body
        .unreadCount,
    ).toBe(10);
  });
  it('marks one read idempotently, preserves its timestamp, and cannot modify another recipient', async () => {
    const a = (
      await call(
        'patch',
        `/notifications/${notifications[2]}/read`,
        'traveler',
      ).expect(200)
    ).body;
    const b = (
      await call(
        'patch',
        `/notifications/${notifications[2]}/read`,
        'traveler',
      ).expect(200)
    ).body;
    expect(a.readAt).not.toBeNull();
    expect(b.readAt).toBe(a.readAt);
    expect(
      (await call('get', '/notifications/unread-count', 'traveler')).body
        .unreadCount,
    ).toBe(9);
    await call(
      'patch',
      `/notifications/${notifications[2]}/read`,
      'other',
    ).expect(404);
    await call(
      'patch',
      `/notifications/${notifications[2]}/read`,
      'admin',
    ).expect(404);
    await call('patch', '/notifications/not-an-id/read', 'traveler').expect(
      404,
    );
    await call(
      'patch',
      `/notifications/${new Types.ObjectId().toString()}/read`,
      'traveler',
    ).expect(404);
  });
  it('marks all own unread notifications only, keeps earlier timestamps and repeats safely', async () => {
    const prior = await m.Notification.findById(notifications[0]).lean();
    expect(
      (await call('patch', '/notifications/read-all', 'traveler').expect(200))
        .body.markedCount,
    ).toBe(10);
    expect(
      (await call('patch', '/notifications/read-all', 'traveler').expect(200))
        .body.markedCount,
    ).toBe(0);
    expect(
      (await call('get', '/notifications/unread-count', 'other')).body
        .unreadCount,
    ).toBe(1);
    expect((await m.Notification.findById(notifications[0])).readAt).toEqual(
      prior.readAt,
    );
  });
  it.each([
    'page=0',
    'page=1.5',
    'page=1e20',
    'unread=null',
    'unread=1',
    'recipientId=123',
    'unread=true&unread=false',
  ])('rejects invalid notification query %s', async (query) => {
    await call('get', '/notifications?' + query, 'traveler').expect(400);
  });
  it('blocks suspended accounts and pending password changes', async () => {
    await m.User.updateOne(
      { _id: ids.traveler },
      { $set: { status: 'suspended' } },
    );
    await call('get', '/notifications', 'traveler').expect(403);
    await call('patch', '/notifications/read-all', 'traveler').expect(403);
    await m.User.updateOne(
      { _id: ids.traveler },
      { $set: { status: 'active', mustChangePassword: true } },
    );
    await call('get', '/notifications', 'traveler').expect(403);
  });
  it('offers notification APIs to admins and both moderator roles for their own inboxes', async () => {
    for (const who of ['admin', 'airMod', 'hotelMod']) {
      expect(
        (await call('get', '/notifications', who).expect(200)).body.items,
      ).toEqual([]);
      expect(
        (await call('get', '/notifications/unread-count', who).expect(200)).body
          .unreadCount,
      ).toBe(0);
      expect(
        (await call('patch', '/notifications/read-all', who).expect(200)).body
          .markedCount,
      ).toBe(0);
    }
  });
  it('enforces moderator ownership for upload and removal before saving files', async () => {
    await call('put', `/airlines/${airline.toString()}/logo`)
      .attach('image', PNG, 'a.png')
      .expect(401);
    await call('post', `/hotels/${hotel.toString()}/photos`)
      .attach('image', PNG, 'a.png')
      .expect(401);
    for (const who of ['traveler', 'admin', 'otherAirMod', 'hotelMod']) {
      await logo(who).expect(403);
      await call('delete', `/airlines/${airline.toString()}/logo`, who)
        .send({ confirm: true })
        .expect(403);
    }
    for (const who of ['traveler', 'admin', 'otherHotelMod', 'airMod']) {
      await photo(who).expect(403);
      await call(
        'delete',
        `/hotels/${hotel.toString()}/photos/${new Types.ObjectId().toString()}`,
        who,
      )
        .send({ confirm: true })
        .expect(403);
    }
    expect(files('airlines')).toEqual([]);
    expect(files('hotels')).toEqual([]);
  });
  it('replaces one logo, serves it by URL, and removes the old and deleted files', async () => {
    const a = (await logo().expect(200)).body.logoUrl;
    expect(existsSync(filePath(a))).toBe(true);
    const image = await request(app.getHttpServer()).get(a).expect(200);
    expect(image.headers['content-type']).toMatch(/image\/png/);
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.body).toEqual(PNG);
    const b = (await logo().expect(200)).body.logoUrl;
    expect(a).not.toBe(b);
    expect(existsSync(filePath(a))).toBe(false);
    expect(files('airlines')).toHaveLength(1);
    expect(
      (await call('get', `/airlines/${airline.toString()}`).expect(200)).body
        .logoUrl,
    ).toBe(b);
    await call('delete', `/airlines/${airline.toString()}/logo`, 'airMod')
      .send({ confirm: true })
      .expect(200);
    expect(files('airlines')).toHaveLength(0);
    expect(
      (await call('get', `/airlines/${airline.toString()}`)).body.logoUrl,
    ).toBeUndefined();
  });
  it('accepts JPEG bytes independent of filename and rejects disguised non-images', async () => {
    await logo('airMod', Buffer.from([0xff, 0xd8, 0xff, 0xd9])).expect(200);
    await logo('airMod', Buffer.from('<script>alert(1)</script>')).expect(400);
    await photo('hotelMod', Buffer.from('not PNG')).expect(400);
    expect(files('airlines')).toHaveLength(1);
    expect(files('hotels')).toHaveLength(0);
  });
  it('rejects missing, wrong-field, multiple and oversized uploads without saving files', async () => {
    await call('put', `/airlines/${airline.toString()}/logo`, 'airMod').expect(
      400,
    );
    await call('post', `/hotels/${hotel.toString()}/photos`, 'hotelMod')
      .attach('file', PNG, 'x.png')
      .expect(400);
    await call('post', `/hotels/${hotel.toString()}/photos`, 'hotelMod')
      .attach('image', PNG, 'x.png')
      .attach('image', PNG, 'y.png')
      .expect(400);
    await logo('airMod', Buffer.alloc(MAX_IMAGE_BYTES + 1)).expect(413);
    await photo('hotelMod', Buffer.alloc(MAX_IMAGE_BYTES + 1)).expect(413);
    expect(files('airlines')).toHaveLength(0);
    expect(files('hotels')).toHaveLength(0);
  });
  it('caps hotel photos at five atomically, cleans rejected files, and permits replacement after removal', async () => {
    for (let i = 0; i < 4; i++) await photo().expect(201);
    const raced = await Promise.all([photo(), photo()]);
    expect(raced.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(files('hotels')).toHaveLength(5);
    const saved = await m.Hotel.findById(hotel);
    expect(saved.photos).toHaveLength(5);
    const first = saved.photos[0];
    await call(
      'delete',
      `/hotels/${hotel.toString()}/photos/${String(first._id)}`,
      'hotelMod',
    )
      .send({ confirm: true })
      .expect(200);
    expect(existsSync(filePath(first.url))).toBe(false);
    await photo().expect(201);
    expect(files('hotels')).toHaveLength(5);
  });
  it('exposes photo ids and URLs in the public hotel profile', async () => {
    const photos = (await photo().expect(201)).body;
    const details = (
      await call('get', `/hotels/${hotel.toString()}`).expect(200)
    ).body;
    expect(details.photos).toEqual(photos);
    expect(details.photoUrls).toEqual(
      photos.map((p: { url: string }) => p.url),
    );
    await request(app.getHttpServer()).get(photos[0].url).expect(200);
  });
  it('requires removal confirmation and refuses invalid or foreign photo ids', async () => {
    const photos = (await photo().expect(201)).body;
    await call(
      'delete',
      `/hotels/${hotel.toString()}/photos/${String(photos[0].id)}`,
      'hotelMod',
    )
      .send({ confirm: false })
      .expect(400);
    await call(
      'delete',
      `/hotels/${hotel.toString()}/photos/${new Types.ObjectId().toString()}`,
      'hotelMod',
    )
      .send({ confirm: true })
      .expect(404);
    await call('delete', `/hotels/${hotel.toString()}/photos/bad`, 'hotelMod')
      .send({ confirm: true })
      .expect(404);
    await logo().expect(200);
    await call('delete', `/airlines/${airline.toString()}/logo`, 'airMod')
      .send({})
      .expect(400);
    expect(files('hotels')).toHaveLength(1);
    expect(files('airlines')).toHaveLength(1);
  });
  it('rejects arbitrary media URLs in profile creation and edits', async () => {
    await call('patch', `/hotels/${hotel.toString()}`, 'hotelMod')
      .send({ photoUrls: ['https://example.com/x.png'] })
      .expect(400);
    await call('post', '/hotels', 'admin')
      .send({ photoUrls: ['https://example.com/x.png'] })
      .expect(400);
    await call('patch', `/airlines/${airline.toString()}`, 'airMod')
      .send({ logoUrl: '/uploads/airlines/another.png' })
      .expect(400);
    await call('post', '/airlines', 'admin')
      .send({
        name: 'Bad',
        code: 'BADMEDIA',
        logoUrl: 'https://example.com/x.png',
      })
      .expect(400);
  });
  it('cleans newly saved files when a database update fails', async () => {
    const hotelSpy = jest
      .spyOn(m.Hotel, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error('simulated write failure');
      });
    await photo().expect(500);
    hotelSpy.mockRestore();
    const airlineSpy = jest
      .spyOn(m.Airline, 'findByIdAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error('simulated write failure');
      });
    await logo().expect(500);
    airlineSpy.mockRestore();
    expect(files('hotels')).toHaveLength(0);
    expect(files('airlines')).toHaveLength(0);
  });
  it('keeps exactly the final logo file after concurrent replacements', async () => {
    await logo().expect(200);
    const results = await Promise.all([logo(), logo()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const current = await m.Airline.findById(airline);
    expect(files('airlines')).toEqual([basename(String(current.logoUrl))]);
    expect(existsSync(filePath(String(current.logoUrl)))).toBe(true);
  });
  it('blocks suspended provider uploads and rejects invalid provider ids', async () => {
    await m.User.updateOne(
      { _id: ids.hotelMod },
      { $set: { status: 'suspended' } },
    );
    await photo().expect(403);
    await call('put', '/airlines/invalid/logo', 'airMod')
      .attach('image', PNG, 'x.png')
      .expect(404);
    await call('post', '/hotels/invalid/photos', 'hotelMod')
      .attach('image', PNG, 'x.png')
      .expect(403);
    expect(files('hotels')).toEqual([]);
    expect(files('airlines')).toEqual([]);
  });
  it('does not delete a sibling directory whose name shares the uploads prefix', async () => {
    const outside = uploadsDir + '-sibling';
    const { mkdirSync } = await import('node:fs');
    mkdirSync(outside);
    const target = join(outside, 'keep.png');
    writeFileSync(target, PNG);
    try {
      await app
        .get(ImageUploadsService)
        .remove(`/uploads/../${basename(outside)}/keep.png`);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
