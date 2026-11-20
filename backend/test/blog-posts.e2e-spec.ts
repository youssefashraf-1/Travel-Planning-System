import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
import { Session } from '../src/auth/schemas/session.schema';
import { BlogPost } from '../src/blog/schemas/blog-post.schema';
import { Comment } from '../src/blog/schemas/comment.schema';
import { Like } from '../src/blog/schemas/like.schema';
import { User, UserRole, UserStatus } from '../src/users/schemas/user.schema';

const TAG = 'blog.group-a.test';
const PASSWORD = 'TestPassword2026';
// Real 1x1 PNG; validation does not rely on the filename or MIME header.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

describe('Blog posts — Phase 11 Group A', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let comments: Model<Comment>;
  let likes: Model<Like>;
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, Types.ObjectId> = {};
  const uploadsDir = mkdtempSync(join(tmpdir(), 'blog-group-a-'));
  const previousUploads = process.env.UPLOADS_DIR;

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const result = request(app.getHttpServer())[method](
      `/api/blog/posts${path}`,
    );
    return who ? result.set('Cookie', cookies[who]) : result;
  };
  const create = (body: object = {}, who = 'author') =>
    call('post', '', who).send({
      title: 'Trip to Cairo',
      body: 'A travel story.',
      ...body,
    });

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    users = app.get(getModelToken(User.name));
    posts = app.get(getModelToken(BlogPost.name));
    comments = app.get(getModelToken(Comment.name));
    likes = app.get(getModelToken(Like.name));
    await Promise.all([users, posts, comments, likes].map((m) => m.init()));
    const hash = await app.get(PasswordHasherService).hash(PASSWORD);
    for (const [name, role] of [
      ['author', UserRole.TRAVELER],
      ['other', UserRole.TRAVELER],
      ['admin', UserRole.ADMIN],
      ['moderator', UserRole.HOTEL_MODERATOR],
    ] as const) {
      const user = await users.create({
        name,
        email: `${name}@${TAG}`,
        passwordHash: hash,
        role,
        assignedProviderId:
          role === UserRole.HOTEL_MODERATOR ? new Types.ObjectId() : undefined,
      });
      ids[name] = user._id;
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      cookies[name] = ([] as string[])
        .concat(login.headers['set-cookie'] ?? [])
        .map((c) => c.split(';')[0]);
    }
  });

  afterAll(async () => {
    if (posts) {
      const postIds = (
        await posts.find({ authorId: { $in: Object.values(ids) } })
      ).map((p) => p._id);
      await comments.deleteMany({ postId: { $in: postIds } });
      await likes.deleteMany({ postId: { $in: postIds } });
      await posts.deleteMany({ _id: { $in: postIds } });
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

  it('requires login for creation and owner lists; accepts every registered role', async () => {
    await call('post', '')
      .send({ title: 'Guest', body: 'No login' })
      .expect(401);
    await call('get', '/mine').expect(401);
    for (const who of ['author', 'admin', 'moderator']) {
      const result = await create({}, who).expect(201);
      expect(result.body.author.id).toBe(ids[who].toString());
      expect(result.body.status).toBe('draft');
      expect(result.body.publishedAt).toBeUndefined();
      expect(result.body.likeCount).toBe(0);
      expect(result.body.commentCount).toBe(0);
      expect(result.body.author.email).toBeUndefined();
    }
  });

  it.each([
    { title: '' },
    { title: '   ' },
    { body: '\n ' },
    { title: null },
    { body: 42 },
    { status: 'private' },
    { status: null },
    { tags: null },
    { tags: ['Egypt', ' egypt '] },
    { tags: Array(6).fill('x') },
    { tags: ['x'.repeat(31)] },
    { tags: [' '] },
    { tags: [42] },
    { tags: 'egypt' },
    { authorId: new Types.ObjectId().toString() },
    { publishedAt: new Date().toISOString() },
    { hiddenAt: null },
    { images: [{ url: '/etc/passwd' }] },
  ])(
    'rejects malformed or server-controlled creation fields: %j',
    async (body) => {
      await create(body).expect(400);
    },
  );

  it('keeps drafts private, lists them for their author and never exposes another author’s drafts', async () => {
    const draft = (await create({ tags: [' Egypt ', 'Cairo'] }).expect(201))
      .body;
    expect(draft.tags).toEqual(['egypt', 'cairo']);
    await call('get', `/${draft.id}`).expect(404);
    await call('get', `/mine/${draft.id}`, 'other').expect(404);
    const own = await call('get', `/mine/${draft.id}`, 'author').expect(200);
    expect(own.body.body).toBe('A travel story.');
    const mine = await call('get', '/mine', 'author').expect(200);
    expect(mine.body.items.some((p: { id: string }) => p.id === draft.id)).toBe(
      true,
    );
    expect(
      mine.body.items.every(
        (p: { author: { id: string } }) =>
          p.author.id === ids.author.toString(),
      ),
    ).toBe(true);
  });

  it('publishes, edits, unpublishes and republishes with server-managed timestamps', async () => {
    const draft = (await create().expect(201)).body;
    const published = (
      await call('patch', `/${draft.id}`, 'author')
        .send({ status: 'published' })
        .expect(200)
    ).body;
    expect(published.publishedAt).toBeDefined();
    expect(
      (await call('get', `/${draft.id}`).expect(200)).body.author.name,
    ).toBe('author');
    const edited = (
      await call('patch', `/${draft.id}`, 'author')
        .send({ title: ' Revised ', body: 'New story', tags: [] })
        .expect(200)
    ).body;
    expect(edited.title).toBe('Revised');
    expect(edited.publishedAt).toBe(published.publishedAt);
    const unpublished = (
      await call('patch', `/${draft.id}`, 'author')
        .send({ status: 'draft' })
        .expect(200)
    ).body;
    expect(unpublished.publishedAt).toBeUndefined();
    await call('get', `/${draft.id}`).expect(404);
    const republished = (
      await call('patch', `/${draft.id}`, 'author')
        .send({ status: 'published' })
        .expect(200)
    ).body;
    expect(Date.parse(republished.publishedAt)).toBeGreaterThanOrEqual(
      Date.parse(published.publishedAt),
    );
    for (const invalid of [
      { title: null },
      { body: ' ' },
      { tags: null },
      { status: null },
      { authorId: ids.other },
    ])
      await call('patch', `/${draft.id}`, 'author').send(invalid).expect(400);
  });

  it('refuses non-owner writes, including admins using the author endpoint', async () => {
    const post = (await create().expect(201)).body;
    for (const who of ['other', 'admin']) {
      await call('patch', `/${post.id}`, who)
        .send({ title: 'Changed' })
        .expect(404);
      await call('delete', `/${post.id}`, who)
        .send({ confirm: true })
        .expect(404);
      await call('post', `/${post.id}/images`, who)
        .attach('image', PNG, 'x.png')
        .expect(404);
    }
    expect((await posts.findById(post.id))?.title).toBe(post.title);
  });

  it('paginates public and own lists, filters normalized tags and excludes drafts and hidden authors/posts', async () => {
    const hidden = (
      await create({ status: 'published', tags: ['visibility'] }).expect(201)
    ).body;
    await posts.updateOne(
      { _id: hidden.id },
      { $set: { hiddenAt: new Date() } },
    );
    for (let i = 0; i < 12; i++)
      await create({
        title: `Page ${i}`,
        status: 'published',
        tags: ['pages'],
      }).expect(201);
    const first = (await call('get', '?tag= PAGES ').expect(200)).body;
    expect(first.totalItems).toBe(12);
    expect(first.items).toHaveLength(10);
    expect(first.totalPages).toBe(2);
    const second = (await call('get', '?tag=pages&page=2').expect(200)).body;
    expect(second.items).toHaveLength(2);
    expect(first.items[0].title).toBe('Page 11');
    expect(
      new Set([...first.items, ...second.items].map((p) => p.id)).size,
    ).toBe(12);
    const mine = (await call('get', '/mine', 'author').expect(200)).body;
    expect(mine.items).toHaveLength(10);
    expect(mine.totalPages).toBeGreaterThan(1);
    const empty = (await call('get', '?tag=absent').expect(200)).body;
    expect(empty.items).toEqual([]);
    expect(empty.totalItems).toBe(0);
    await call('get', '?page=0').expect(400);
    await call('get', '?page=abc').expect(400);
    await call('get', '?unexpected=1').expect(400);
    await call('get', `/${hidden.id}`).expect(404);
    await call('get', `/mine/${hidden.id}`, 'author').expect(200);
    await call('patch', `/${hidden.id}`, 'author')
      .send({ status: 'draft' })
      .expect(200);
    await call('patch', `/${hidden.id}`, 'author')
      .send({ status: 'published' })
      .expect(200);
    await call('get', `/${hidden.id}`).expect(404);
    const otherPost = (
      await create(
        { status: 'published', tags: ['deactivated'] },
        'other',
      ).expect(201)
    ).body;
    await users.updateOne(
      { _id: ids.other },
      { $set: { status: UserStatus.DEACTIVATED } },
    );
    try {
      await call('get', `/${otherPost.id}`).expect(404);
      expect(
        (await call('get', '?tag=deactivated').expect(200)).body.totalItems,
      ).toBe(0);
      await create({}, 'other').expect(403);
    } finally {
      await users.updateOne(
        { _id: ids.other },
        { $set: { status: UserStatus.ACTIVE } },
      );
    }
  });

  it('returns interaction counts, excluding hidden comments, without exposing drafts', async () => {
    const p = (await create({ status: 'published' }).expect(201)).body;
    await likes.create({ postId: p.id, userId: ids.other });
    await comments.create([
      { postId: p.id, authorId: ids.other, body: 'Visible' },
      {
        postId: p.id,
        authorId: ids.other,
        body: 'Hidden',
        hiddenAt: new Date(),
      },
    ]);
    const detail = (await call('get', `/${p.id}`).expect(200)).body;
    expect(detail.likeCount).toBe(1);
    expect(detail.commentCount).toBe(1);
  });

  it('validates image content, size and count; removes image files', async () => {
    const p = (await create().expect(201)).body;
    await call('post', `/${p.id}/images`, 'author').expect(400);
    await call('post', `/${p.id}/images`, 'author')
      .attach('image', Buffer.from('fake image'), 'fake.png')
      .expect(400);
    await call('post', `/${p.id}/images`, 'author')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
      .expect(413);
    let images: { id: string; url: string }[] = [];
    for (let i = 0; i < 5; i++)
      images = (
        await call('post', `/${p.id}/images`, 'author')
          .attach('image', PNG, 'photo.png')
          .expect(201)
      ).body.images;
    const image = images[0];
    await request(app.getHttpServer()).get(image.url).expect(200);
    await call('post', `/${p.id}/images`, 'author')
      .attach('image', PNG, 'sixth.png')
      .expect(400);
    await call('delete', `/${p.id}/images/${image.id}`, 'other')
      .send({ confirm: true })
      .expect(404);
    await call('delete', `/${p.id}/images/not-an-id`, 'author')
      .send({ confirm: true })
      .expect(404);
    await call('delete', `/${p.id}/images/${image.id}`, 'author')
      .send({ confirm: false })
      .expect(400);
    const removed = await call(
      'delete',
      `/${p.id}/images/${image.id}`,
      'author',
    )
      .send({ confirm: true })
      .expect(200);
    expect(removed.body.images).toHaveLength(4);
    expect(
      existsSync(join(uploadsDir, image.url.replace('/uploads/', ''))),
    ).toBe(false);
    await request(app.getHttpServer()).get(image.url).expect(404);
    await call('delete', `/${p.id}`, 'author')
      .send({ confirm: true })
      .expect(204);
    for (const image of images)
      expect(
        existsSync(join(uploadsDir, image.url.replace('/uploads/', ''))),
      ).toBe(false);
  });

  it('requires explicit deletion confirmation and removes dependent records', async () => {
    const p = (await create().expect(201)).body;
    await likes.create({ postId: p.id, userId: ids.other });
    await comments.create({
      postId: p.id,
      authorId: ids.other,
      body: 'Existing comment',
    });
    for (const body of [{}, { confirm: false }, { confirm: 'true' }])
      await call('delete', `/${p.id}`, 'author').send(body).expect(400);
    await call('delete', `/${p.id}`, 'author')
      .send({ confirm: true })
      .expect(204);
    expect(await posts.findById(p.id)).toBeNull();
    expect(await likes.countDocuments({ postId: p.id })).toBe(0);
    expect(await comments.countDocuments({ postId: p.id })).toBe(0);
    await call('get', `/mine/${p.id}`, 'author').expect(404);
    for (const id of ['not-an-id', new Types.ObjectId().toString()]) {
      await call('get', `/${id}`).expect(404);
      await call('patch', `/${id}`, 'author').send({ title: 'No' }).expect(404);
    }
  });

  it('uses version checks rather than overwriting a concurrent edit', async () => {
    const p = (await create().expect(201)).body;
    const a = (await posts.findById(p.id))!;
    const b = (await posts.findById(p.id))!;
    a.title = 'First';
    await a.save();
    b.body = 'Stale';
    await expect(b.save()).rejects.toMatchObject({ name: 'VersionError' });
    expect((await posts.findById(p.id))?.body).toBe('A travel story.');
  });

  it('does not exceed the image limit under simultaneous uploads or leave unused files', async () => {
    const p = (await create().expect(201)).body;
    for (let i = 0; i < 4; i++)
      await call('post', `/${p.id}/images`, 'author')
        .attach('image', PNG, 'p.png')
        .expect(201);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('post', `/${p.id}/images`, 'author').attach(
          'image',
          PNG,
          'race.png',
        ),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [201, 400, 409].includes(r.status))).toBe(true);
    const stored = (await posts.findById(p.id))!;
    expect(stored.images).toHaveLength(5);
    const allPosts = await posts.find({
      authorId: { $in: Object.values(ids) },
    });
    expect(readdirSync(join(uploadsDir, 'posts')).length).toBe(
      allPosts.reduce((count, item) => count + item.images.length, 0),
    );
  });
});
