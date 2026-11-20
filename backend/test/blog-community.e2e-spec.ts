import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  AuditAction,
  AuditLog,
} from '../src/audit-logs/schemas/audit-log.schema';
import { Session } from '../src/auth/schemas/session.schema';
import { BlogPost } from '../src/blog/schemas/blog-post.schema';
import { Comment } from '../src/blog/schemas/comment.schema';
import { Like } from '../src/blog/schemas/like.schema';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { Itinerary } from '../src/itineraries/schemas/itinerary.schema';
import { Report } from '../src/reports/schemas/report.schema';
import { Review } from '../src/reviews/schemas/review.schema';
import { User, UserRole, UserStatus } from '../src/users/schemas/user.schema';

const TAG = 'phase11.community.test';
const PASSWORD = 'TestPassword2026';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

describe('Phase 11 community, discovery and moderation', () => {
  let app: INestApplication<App>;
  let users: Model<User>,
    posts: Model<BlogPost>,
    comments: Model<Comment>,
    likes: Model<Like>;
  let itineraries: Model<Itinerary>,
    reviews: Model<Review>,
    reports: Model<Report>,
    audit: Model<AuditLog>;
  let hotelId: Types.ObjectId;
  const ids: Record<string, Types.ObjectId> = {};
  const cookies: Record<string, string[]> = {};
  const uploadsDir = mkdtempSync(join(tmpdir(), 'phase11-community-'));
  const previousUploads = process.env.UPLOADS_DIR;
  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const result = request(app.getHttpServer())[method]('/api' + path);
    return who ? result.set('Cookie', cookies[who]) : result;
  };
  const post = async (extra = {}, who = 'author') =>
    (
      await call('post', '/blog/posts', who)
        .send({
          title: 'A community journey',
          body: 'Travel story.',
          status: 'published',
          ...extra,
        })
        .expect(201)
    ).body;
  const comment = async (postId: string, body = 'Nice trip', who = 'other') =>
    (
      await call('post', `/blog/posts/${postId}/comments`, who)
        .send({ body })
        .expect(201)
    ).body;
  const report = async (type: string, id: string, who = 'other') =>
    (
      await call('post', '/reports', who)
        .send({
          targetType: type,
          targetId: id,
          reason: 'Please review this content.',
        })
        .expect(201)
    ).body;

  async function target(type: string) {
    if (type === 'post') return (await post()).id as string;
    if (type === 'comment')
      return (
        await comment((await post()).id, 'Moderate this comment', 'author')
      ).id as string;
    if (type === 'review')
      return (
        await reviews.create({
          bookingId: new Types.ObjectId(),
          hotelId,
          authorId: ids.author,
          rating: 5,
          body: 'Review text',
        })
      ).id as string;
    return (
      await itineraries.create({
        ownerId: ids.author,
        title: 'Community itinerary',
        countryCodes: ['EG'],
        startDate: '2027-01-01',
        visibility: 'public',
      })
    ).id as string;
  }

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication({ rawBody: true });
    app.useLogger(false);
    configureApp(app);
    await app.init();
    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    users = model(User.name);
    posts = model(BlogPost.name);
    comments = model(Comment.name);
    likes = model(Like.name);
    itineraries = model(Itinerary.name);
    reviews = model(Review.name);
    reports = model(Report.name);
    audit = model(AuditLog.name);
    await Promise.all(
      [users, posts, comments, likes, itineraries, reviews, reports, audit].map(
        (m) => m.init(),
      ),
    );
    const hash = await app.get(PasswordHasherService).hash(PASSWORD);
    for (const [name, role] of [
      ['author', UserRole.TRAVELER],
      ['other', UserRole.TRAVELER],
      ['third', UserRole.TRAVELER],
      ['admin', UserRole.ADMIN],
      ['moderator', UserRole.HOTEL_MODERATOR],
    ] as const) {
      const user = await users.create({
        name: `Community ${name}`,
        email: `${name}@${TAG}`,
        passwordHash: hash,
        role,
        assignedProviderId:
          role === UserRole.HOTEL_MODERATOR ? new Types.ObjectId() : undefined,
      });
      ids[name] = user._id;
      const result = await call('post', '/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      cookies[name] = ([] as string[])
        .concat(result.headers['set-cookie'] ?? [])
        .map((c) => c.split(';')[0]);
    }
    const hotel = await model<Hotel>(Hotel.name).create({
      name: TAG,
      address: 'Test',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
      description: 'Test hotel',
      starClass: 3,
      policy: {
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [],
      },
    });
    hotelId = hotel._id;
  });

  afterAll(async () => {
    if (users) {
      const postIds = (
        await posts.find({ authorId: { $in: Object.values(ids) } })
      ).map((p) => p._id);
      await comments.deleteMany({
        $or: [
          { postId: { $in: postIds } },
          { authorId: { $in: Object.values(ids) } },
        ],
      });
      await likes.deleteMany({ postId: { $in: postIds } });
      await posts.deleteMany({ _id: { $in: postIds } });
      await itineraries.deleteMany({ ownerId: { $in: Object.values(ids) } });
      await reviews.deleteMany({ hotelId });
      await reports.deleteMany({ reporterId: { $in: Object.values(ids) } });
      await audit.deleteMany({ actorId: { $in: Object.values(ids) } });
      await app
        .get<Model<Hotel>>(getModelToken(Hotel.name))
        .deleteOne({ _id: hotelId });
      await app
        .get<Model<Session>>(getModelToken(Session.name))
        .deleteMany({ userId: { $in: Object.values(ids) } });
      await users.deleteMany({ _id: { $in: Object.values(ids) } });
    }
    if (app) await app.close();
    if (previousUploads === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploads;
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('requires authentication for comments, likes and reporting, and admin role for moderation', async () => {
    const p = await post();
    await call('post', `/blog/posts/${p.id}/comments`)
      .send({ body: 'Guest' })
      .expect(401);
    await call('post', `/blog/posts/${p.id}/like`).expect(401);
    await call('post', '/reports')
      .send({ targetType: 'post', targetId: p.id, reason: 'Guest' })
      .expect(401);
    await call('get', '/admin/reports').expect(401);
    for (const who of ['author', 'moderator']) {
      await call('get', '/admin/reports', who).expect(403);
      await call('get', `/admin/content/post/${p.id}`, who).expect(403);
      await call('patch', `/admin/content/post/${p.id}/hide`, who)
        .send({ confirm: true })
        .expect(403);
      await call('delete', `/admin/content/post/${p.id}`, who)
        .send({ confirm: true })
        .expect(403);
    }
  });

  it.each(['', '   ', 'x'.repeat(501), null, 42])(
    'rejects invalid comments: %j',
    async (body) => {
      const p = await post();
      await call('post', `/blog/posts/${p.id}/comments`, 'other')
        .send({ body })
        .expect(400);
    },
  );

  it('adds, paginates and embeds chronological comments; only their author can edit/delete', async () => {
    const p = await post();
    const list = [];
    for (let i = 0; i < 12; i++) list.push(await comment(p.id, `Comment ${i}`));
    const first = (
      await call('get', `/blog/posts/${p.id}/comments`).expect(200)
    ).body;
    expect(first.totalItems).toBe(12);
    expect(first.items).toHaveLength(10);
    expect(first.items[0].body).toBe('Comment 0');
    expect(first.items[9].body).toBe('Comment 9');
    const detail = (await call('get', `/blog/posts/${p.id}?page=2`).expect(200))
      .body;
    expect(detail.comments.items.map((c: { body: string }) => c.body)).toEqual([
      'Comment 10',
      'Comment 11',
    ]);
    expect(detail.commentCount).toBe(12);
    await call('patch', `/blog/comments/${list[0].id}`, 'author')
      .send({ body: 'Not my comment' })
      .expect(404);
    await call('delete', `/blog/comments/${list[0].id}`, 'author')
      .send({ confirm: true })
      .expect(404);
    await call('patch', `/blog/comments/${list[0].id}`, 'other')
      .send({ body: '  Edited  ' })
      .expect(200)
      .expect((r) => expect(r.body.body).toBe('Edited'));
    await call('patch', `/blog/comments/${list[0].id}`, 'other')
      .send({ body: null })
      .expect(400);
    await call('post', `/blog/posts/${p.id}/comments`, 'other')
      .send({ body: 'Spoof', authorId: ids.author })
      .expect(400);
    await call('delete', `/blog/comments/${list[0].id}`, 'other')
      .send({ confirm: false })
      .expect(400);
    await call('delete', `/blog/comments/${list[0].id}`, 'other')
      .send({ confirm: true })
      .expect(204);
    expect(
      (await call('get', `/blog/posts/${p.id}`).expect(200)).body.commentCount,
    ).toBe(11);
    await call('get', `/blog/posts/${p.id}/comments?page=0`).expect(400);
  });

  it('stores one like under concurrent requests and safely repeats unlike', async () => {
    const p = await post();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        call('post', `/blog/posts/${p.id}/like`, 'other'),
      ),
    );
    expect(results.every((r) => r.status === 200 && r.body.liked)).toBe(true);
    expect(
      await likes.countDocuments({ postId: p.id, userId: ids.other }),
    ).toBe(1);
    await call('post', `/blog/posts/${p.id}/like`, 'third')
      .expect(200)
      .expect((r) => expect(r.body.likeCount).toBe(2));
    for (let i = 0; i < 2; i++)
      await call('delete', `/blog/posts/${p.id}/like`, 'other')
        .expect(200)
        .expect((r) => {
          expect(r.body.liked).toBe(false);
          expect(r.body.likeCount).toBe(1);
        });
    expect(
      (await call('get', `/blog/posts/${p.id}`).expect(200)).body.likeCount,
    ).toBe(1);
  });

  it('rejects interacting with drafts, hidden posts, missing posts and deactivated authors', async () => {
    const draft = await post({ status: 'draft' });
    const hidden = await post();
    await posts.updateOne(
      { _id: hidden.id },
      { $set: { hiddenAt: new Date() } },
    );
    const deactivated = await post({}, 'third');
    await users.updateOne(
      { _id: ids.third },
      { $set: { status: UserStatus.DEACTIVATED } },
    );
    try {
      for (const id of [
        draft.id,
        hidden.id,
        deactivated.id,
        'invalid',
        new Types.ObjectId().toString(),
      ]) {
        await call('post', `/blog/posts/${id}/like`, 'other').expect(404);
        await call('post', `/blog/posts/${id}/comments`, 'other')
          .send({ body: 'No' })
          .expect(404);
        await call('get', `/blog/posts/${id}/comments`).expect(404);
      }
    } finally {
      await users.updateOne(
        { _id: ids.third },
        { $set: { status: UserStatus.ACTIVE } },
      );
    }
  });

  it('anonymizes deactivated commenters while keeping their visible comments', async () => {
    const p = await post();
    await comment(p.id, 'Preserved comment', 'third');
    await users.updateOne(
      { _id: ids.third },
      { $set: { status: UserStatus.DEACTIVATED } },
    );
    try {
      const c = (await call('get', `/blog/posts/${p.id}/comments`).expect(200))
        .body.items[0];
      expect(c.authorName).toBe('Deleted user');
      expect(c.authorId).toBeUndefined();
    } finally {
      await users.updateOne(
        { _id: ids.third },
        { $set: { status: UserStatus.ACTIVE } },
      );
    }
  });

  it('searches title, tags and author literally and orders by visible interaction score then date', async () => {
    const old = await post({ title: 'RankMarker older', tags: ['rankmarker'] });
    const newer = await post({
      title: 'RankMarker newer',
      body: 'UniqueBodyOnlyToken',
    });
    await posts.updateOne(
      { _id: old.id },
      { $set: { publishedAt: new Date('2026-01-01') } },
    );
    await posts.updateOne(
      { _id: newer.id },
      { $set: { publishedAt: new Date('2026-02-01') } },
    );
    await call('post', `/blog/posts/${old.id}/like`, 'other').expect(200);
    await comment(old.id);
    const hidden = await comment(newer.id, 'Hidden comment');
    await comments.updateOne(
      { _id: hidden.id },
      { $set: { hiddenAt: new Date() } },
    );
    const search = (
      await call('get', '/blog/posts/search?keyword=rankmarker').expect(200)
    ).body;
    expect(search.items.map((item: { id: string }) => item.id)).toEqual([
      old.id,
      newer.id,
    ]);
    expect(search.items[0].interactionScore).toBe(2);
    expect(search.items[1].interactionScore).toBe(0);
    expect(search.items[0].excerpt).toBe('Travel story.');
    await call('post', `/blog/posts/${newer.id}/like`, 'other').expect(200);
    await comment(newer.id);
    expect(
      (await call('get', '/blog/posts/search?keyword=rankmarker').expect(200))
        .body.items[0].id,
    ).toBe(newer.id);
    expect(
      (
        await call(
          'get',
          '/blog/posts/search?keyword=UniqueBodyOnlyToken',
        ).expect(200)
      ).body.items,
    ).toEqual([]);
    const tagged = await post({
      title: 'Unrelated title',
      tags: ['uniquetagmark'],
    });
    expect(
      (
        await call('get', '/blog/posts/search?keyword=uniquetagmark').expect(
          200,
        )
      ).body.items[0].id,
    ).toBe(tagged.id);
    expect(
      (
        await call(
          'get',
          '/blog/posts/search?keyword=Community%20author',
        ).expect(200)
      ).body.totalItems,
    ).toBeGreaterThan(0);
    expect(
      (await call('get', '/blog/posts/search?keyword=.*').expect(200)).body
        .items,
    ).toEqual([]);
    await call('get', '/blog/posts/search?keyword=').expect(400);
    await call('get', '/blog/posts/search?keyword=' + 'x'.repeat(101)).expect(
      400,
    );
  });

  it('public author page excludes private/draft/hidden records and independently paginates posts and itineraries', async () => {
    const privatePost = await post({ status: 'draft' });
    const hiddenPost = await post();
    await posts.updateOne(
      { _id: hiddenPost.id },
      { $set: { hiddenAt: new Date() } },
    );
    const publicItinerary = await itineraries.create({
      ownerId: ids.author,
      title: 'Visible itinerary',
      countryCodes: ['EG'],
      startDate: '2027-01-01',
      visibility: 'public',
    });
    const privateItinerary = await itineraries.create({
      ownerId: ids.author,
      title: 'Private itinerary',
      countryCodes: ['EG'],
      startDate: '2027-01-01',
      visibility: 'private',
    });
    const hiddenItinerary = await itineraries.create({
      ownerId: ids.author,
      title: 'Hidden itinerary',
      countryCodes: ['EG'],
      startDate: '2027-01-01',
      visibility: 'public',
      hiddenAt: new Date(),
    });
    const page = (
      await call('get', `/blog/authors/${ids.author.toString()}`).expect(200)
    ).body;
    expect(page.name).toBe('Community author');
    expect(page.joinedAt).toBeDefined();
    expect(page.email).toBeUndefined();
    expect(page.posts.items).toHaveLength(10);
    expect(
      page.posts.items.every(
        (p: { id: string; status: string }) =>
          p.status === 'published' &&
          ![privatePost.id, hiddenPost.id].includes(p.id),
      ),
    ).toBe(true);
    expect(page.itineraries.items.map((i: { id: string }) => i.id)).toContain(
      publicItinerary.id,
    );
    expect(
      page.itineraries.items.map((i: { id: string }) => i.id),
    ).not.toContain(privateItinerary.id);
    expect(
      page.itineraries.items.map((i: { id: string }) => i.id),
    ).not.toContain(hiddenItinerary.id);
    const second = (
      await call(
        'get',
        `/blog/authors/${ids.author.toString()}?page=2&itinerariesPage=2`,
      ).expect(200)
    ).body;
    expect(second.posts.page).toBe(2);
    expect(second.itineraries.page).toBe(2);
    expect(second.itineraries.items).toEqual([]);
    await call(
      'get',
      `/blog/authors/${ids.author.toString()}?itinerariesPage=0`,
    ).expect(400);
    await users.updateOne(
      { _id: ids.third },
      { $set: { status: UserStatus.DEACTIVATED } },
    );
    try {
      await call('get', `/blog/authors/${ids.third.toString()}`).expect(404);
    } finally {
      await users.updateOne(
        { _id: ids.third },
        { $set: { status: UserStatus.ACTIVE } },
      );
    }
    await call('get', '/blog/authors/not-an-id').expect(404);
  });

  it.each(['post', 'comment', 'review', 'itinerary'])(
    'reports %s once, permits a different reporter and dismisses with an audit entry',
    async (type) => {
      const id = await target(type);
      const created = await report(type, id);
      expect(created.status).toBe('open');
      expect(created.reporterId).toBe(ids.other.toString());
      await call('post', '/reports', 'other')
        .send({ targetType: type, targetId: id, reason: 'Again' })
        .expect(409);
      await report(type, id, 'third');
      const open = (await call('get', '/admin/reports', 'admin').expect(200))
        .body;
      expect(
        open.items.every((r: { status: string }) => r.status === 'open'),
      ).toBe(true);
      await call('post', `/admin/reports/${created.id}/resolve`, 'other')
        .send({ action: 'dismiss', confirm: true })
        .expect(403);
      await call('post', `/admin/reports/${created.id}/resolve`, 'admin')
        .send({ action: 'dismiss', confirm: false })
        .expect(400);
      const result = (
        await call('post', `/admin/reports/${created.id}/resolve`, 'admin')
          .send({ action: 'dismiss', confirm: true })
          .expect(200)
      ).body;
      expect(result.status).toBe('dismissed');
      expect(result.resolvedById).toBe(ids.admin.toString());
      expect(result.resolvedAt).toBeDefined();
      expect(
        await audit.countDocuments({
          reportId: created.id,
          action: AuditAction.REPORT_DISMISSED,
        }),
      ).toBe(1);
      await call('post', `/admin/reports/${created.id}/resolve`, 'admin')
        .send({ action: 'dismiss', confirm: true })
        .expect(409);
      await call('post', '/reports', 'other')
        .send({ targetType: type, targetId: id, reason: 'After resolution' })
        .expect(409);
    },
  );

  it.each(['post', 'comment', 'review', 'itinerary'])(
    'hides reported %s, resolves related reports, preserves author/admin visibility and writes an audit entry',
    async (type) => {
      const id = await target(type);
      const r = await report(type, id);
      const second = await report(type, id, 'third');
      const result = (
        await call('post', `/admin/reports/${r.id}/resolve`, 'admin')
          .send({ action: 'hide', confirm: true })
          .expect(200)
      ).body;
      expect(result.status).toBe('content_hidden');
      expect((await reports.findById(second.id))?.status).toBe(
        'content_hidden',
      );
      expect(
        await audit.countDocuments({
          reportId: r.id,
          action: AuditAction.CONTENT_HIDDEN,
        }),
      ).toBe(1);
      const inspected = (
        await call('get', `/admin/content/${type}/${id}`, 'admin').expect(200)
      ).body;
      expect(inspected.content.hiddenAt).toBeDefined();
      await call('get', `/content/mine/${type}/${id}`, 'author').expect(200);
      await call('get', `/content/mine/${type}/${id}`, 'other').expect(404);
      await call('post', '/reports', 'other')
        .send({ targetType: type, targetId: id, reason: 'Hidden already' })
        .expect(404);
      if (type === 'post') {
        await call('get', `/blog/posts/${id}`).expect(404);
        await call('post', `/blog/posts/${id}/like`, 'other').expect(404);
      }
      if (type === 'comment') {
        const c = (await comments.findById(id))!;
        const list = (
          await call(
            'get',
            `/blog/posts/${c.postId.toString()}/comments`,
          ).expect(200)
        ).body;
        expect(list.items.some((item: { id: string }) => item.id === id)).toBe(
          false,
        );
        await call('patch', `/blog/comments/${id}`, 'author')
          .send({ body: 'Still hidden after editing' })
          .expect(200);
        expect((await comments.findById(id))?.hiddenAt).toBeDefined();
      }
      if (type === 'itinerary') {
        await call('get', `/itineraries/public/${id}`).expect(404);
        expect(
          (
            await call('get', `/blog/authors/${ids.author.toString()}`).expect(
              200,
            )
          ).body.itineraries.items.some(
            (item: { id: string }) => item.id === id,
          ),
        ).toBe(false);
      }
      if (type === 'review')
        expect(
          (
            await call('get', `/hotels/${hotelId.toString()}/reviews`).expect(
              200,
            )
          ).body.items.some((item: { id: string }) => item.id === id),
        ).toBe(false);
    },
  );

  it.each(['post', 'comment', 'review', 'itinerary'])(
    'directly deletes %s with confirmation and resolves its reports',
    async (type) => {
      const id = await target(type);
      const r = await report(type, id);
      await call('delete', `/admin/content/${type}/${id}`, 'admin')
        .send({ confirm: false })
        .expect(400);
      await call('delete', `/admin/content/${type}/${id}`, 'admin')
        .send({ confirm: true })
        .expect(204);
      await call('get', `/admin/content/${type}/${id}`, 'admin').expect(404);
      expect((await reports.findById(r.id))?.status).toBe('content_deleted');
      expect(
        await audit.countDocuments({
          targetId: id,
          action: AuditAction.CONTENT_DELETED,
        }),
      ).toBe(1);
    },
  );

  it('deletes reported posts through report resolution, including child interactions, child reports and image files', async () => {
    const p = await post();
    const c = await comment(p.id);
    await call('post', `/blog/posts/${p.id}/like`, 'other').expect(200);
    const image = (
      await call('post', `/blog/posts/${p.id}/images`, 'author')
        .attach('image', PNG, 'photo.png')
        .expect(201)
    ).body.images[0];
    const r = await report('post', p.id);
    const cr = await report('comment', c.id);
    await call('post', `/admin/reports/${r.id}/resolve`, 'admin')
      .send({ action: 'delete', confirm: true })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('content_deleted'));
    expect(await posts.findById(p.id)).toBeNull();
    expect(await comments.countDocuments({ postId: p.id })).toBe(0);
    expect(await likes.countDocuments({ postId: p.id })).toBe(0);
    expect((await reports.findById(cr.id))?.status).toBe('content_deleted');
    expect(
      existsSync(join(uploadsDir, image.url.replace('/uploads/', ''))),
    ).toBe(false);
  });

  it('removes itinerary activity images on administrator deletion', async () => {
    const itinerary = await itineraries.create({
      ownerId: ids.author,
      title: 'Media itinerary',
      countryCodes: ['EG'],
      startDate: '2027-01-01',
      visibility: 'public',
      days: [
        {
          cityId: 'cairo',
          activities: [
            { name: 'Visit', description: 'Museum visit', images: [] },
          ],
        },
      ],
    });
    const activityId = (
      itinerary.toObject().days[0].activities[0] as unknown as {
        _id: Types.ObjectId;
      }
    )._id;
    const uploaded = (
      await call(
        'post',
        `/activities/${activityId.toString()}/images`,
        'author',
      )
        .attach('image', PNG, 'activity.png')
        .expect(201)
    ).body;
    const url = uploaded.days[0].activities[0].images[0].url;
    expect(existsSync(join(uploadsDir, url.replace('/uploads/', '')))).toBe(
      true,
    );
    await call('delete', `/admin/content/itinerary/${itinerary.id}`, 'admin')
      .send({ confirm: true })
      .expect(204);
    expect(existsSync(join(uploadsDir, url.replace('/uploads/', '')))).toBe(
      false,
    );
  });

  it('rolls back content/report changes if audit storage fails', async () => {
    const p = await post();
    const r = await report('post', p.id);
    const failure = jest.spyOn(audit, 'create').mockImplementationOnce(() => {
      throw new Error('Simulated audit storage failure');
    });
    try {
      await call('post', `/admin/reports/${r.id}/resolve`, 'admin')
        .send({ action: 'hide', confirm: true })
        .expect(500);
    } finally {
      failure.mockRestore();
    }
    expect((await posts.findById(p.id))?.hiddenAt).toBeUndefined();
    expect((await reports.findById(r.id))?.status).toBe('open');
    expect(await audit.countDocuments({ reportId: r.id })).toBe(0);
    await call('post', `/admin/reports/${r.id}/resolve`, 'admin')
      .send({ action: 'hide', confirm: true })
      .expect(200);
  });

  it('direct hiding is idempotent; owners see hidden comments and post edits cannot unhide content', async () => {
    const p = await post({ title: 'DirectHideUniqueMarker' });
    const c = await comment(p.id);
    for (let i = 0; i < 2; i++)
      await call('patch', `/admin/content/comment/${c.id}/hide`, 'admin')
        .send({ confirm: true })
        .expect(204);
    expect(
      await audit.countDocuments({
        targetId: c.id,
        action: AuditAction.CONTENT_HIDDEN,
      }),
    ).toBe(1);
    const mine = (await call('get', '/blog/comments/mine', 'other').expect(200))
      .body;
    expect(
      mine.items.some(
        (item: { id: string; hidden: boolean }) =>
          item.id === c.id && item.hidden,
      ),
    ).toBe(true);
    await call('get', '/blog/comments/mine').expect(401);
    await call('patch', `/admin/content/post/${p.id}/hide`, 'admin')
      .send({ confirm: true })
      .expect(204);
    await call('patch', `/blog/posts/${p.id}`, 'author')
      .send({ title: 'DirectHideUniqueMarker edited' })
      .expect(200);
    expect(
      (
        await call(
          'get',
          '/blog/posts/search?keyword=DirectHideUniqueMarker',
        ).expect(200)
      ).body.totalItems,
    ).toBe(0);
    await call('get', `/blog/posts/mine/${p.id}`, 'author').expect(200);
    await call('get', `/blog/posts/${p.id}/comments`).expect(404);
  });

  it('allows only one final decision when administrators resolve the same report concurrently', async () => {
    const p = await post();
    const r = await report('post', p.id);
    const results = await Promise.all(
      ['dismiss', 'hide'].map((action) =>
        call('post', `/admin/reports/${r.id}/resolve`, 'admin').send({
          action,
          confirm: true,
        }),
      ),
    );
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    expect(await audit.countDocuments({ reportId: r.id })).toBe(1);
    expect(['dismissed', 'content_hidden']).toContain(
      (await reports.findById(r.id))?.status,
    );
  });

  it('rejects malformed reports and non-public targets; can dismiss a report after author deletion', async () => {
    const p = await post();
    for (const extra of [
      { reason: '' },
      { reason: '  ' },
      { reason: null },
      { reason: 'x'.repeat(1001) },
      { targetId: 'invalid' },
      { targetType: 'user' },
      { reporterId: ids.admin },
      { status: 'dismissed' },
    ])
      await call('post', '/reports', 'other')
        .send({
          targetType: 'post',
          targetId: p.id,
          reason: 'Reason',
          ...extra,
        })
        .expect(400);
    const draft = await post({ status: 'draft' });
    await call('post', '/reports', 'other')
      .send({
        targetType: 'post',
        targetId: draft.id,
        reason: 'No draft leaks',
      })
      .expect(404);
    const privateItinerary = await itineraries.create({
      ownerId: ids.author,
      title: 'Private',
      countryCodes: ['EG'],
      startDate: '2027-01-01',
    });
    await call('post', '/reports', 'other')
      .send({
        targetType: 'itinerary',
        targetId: privateItinerary.id,
        reason: 'Private',
      })
      .expect(404);
    const r = await report('post', p.id);
    await call('delete', `/blog/posts/${p.id}`, 'author')
      .send({ confirm: true })
      .expect(204);
    await call('post', `/admin/reports/${r.id}/resolve`, 'admin')
      .send({ action: 'hide', confirm: true })
      .expect(404);
    await call('post', `/admin/reports/${r.id}/resolve`, 'admin')
      .send({ action: 'dismiss', confirm: true })
      .expect(200);
    await call('get', '/admin/reports?status=wrong', 'admin').expect(400);
    await call('get', '/admin/content/user/' + ids.author, 'admin').expect(400);
  });

  it('prevents duplicate reports under concurrency and paginates admin lists', async () => {
    const p = await post();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('post', '/reports', 'other').send({
          targetType: 'post',
          targetId: p.id,
          reason: 'Concurrent report',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    for (let i = 0; i < 11; i++) await report('post', (await post()).id);
    const first = (await call('get', '/admin/reports', 'admin').expect(200))
      .body;
    const second = (
      await call('get', '/admin/reports?page=2', 'admin').expect(200)
    ).body;
    expect(first.items).toHaveLength(10);
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.page).toBe(2);
    expect(
      new Set([...first.items, ...second.items].map((r) => r.id)).size,
    ).toBe(first.items.length + second.items.length);
  });

  it('does not leave orphan comments/likes when a post is deleted during interaction', async () => {
    const p = await post();
    const results = await Promise.all([
      call('post', `/blog/posts/${p.id}/comments`, 'other').send({
        body: 'Race comment',
      }),
      call('post', `/blog/posts/${p.id}/like`, 'third'),
      call('delete', `/blog/posts/${p.id}`, 'author').send({ confirm: true }),
    ]);
    expect(
      results.every((r) => [200, 201, 204, 404, 409].includes(r.status)),
    ).toBe(true);
    if (await posts.exists({ _id: p.id }))
      await call('delete', `/blog/posts/${p.id}`, 'author')
        .send({ confirm: true })
        .expect(204);
    expect(await comments.countDocuments({ postId: p.id })).toBe(0);
    expect(await likes.countDocuments({ postId: p.id })).toBe(0);
  });

  it('accepts exact Unicode character limits and rejects longer comments/tags', async () => {
    const p = await post({ tags: ['🌍'.repeat(30)] });
    const c = await comment(p.id, '🌍'.repeat(500));
    expect(c.body).toBe('🌍'.repeat(500));
    await call('patch', `/blog/comments/${c.id}`, 'other')
      .send({ body: '🌍'.repeat(501) })
      .expect(400);
    await call('patch', `/blog/posts/${p.id}`, 'author')
      .send({ tags: ['🌍'.repeat(31)] })
      .expect(400);
  });

  it('suspension and pending password change immediately block interactions', async () => {
    const p = await post();
    await users.updateOne(
      { _id: ids.other },
      { $set: { status: UserStatus.SUSPENDED } },
    );
    try {
      await call('post', `/blog/posts/${p.id}/like`, 'other').expect(403);
      await call('post', '/reports', 'other')
        .send({ targetType: 'post', targetId: p.id, reason: 'Suspended' })
        .expect(403);
    } finally {
      await users.updateOne(
        { _id: ids.other },
        { $set: { status: UserStatus.ACTIVE, mustChangePassword: true } },
      );
    }
    try {
      await call('post', `/blog/posts/${p.id}/comments`, 'other')
        .send({ body: 'Blocked' })
        .expect(403);
    } finally {
      await users.updateOne(
        { _id: ids.other },
        { $set: { mustChangePassword: false } },
      );
    }
  });
});
