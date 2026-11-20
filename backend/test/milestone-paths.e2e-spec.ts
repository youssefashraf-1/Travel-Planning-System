import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app/app.module';
import { configureApp, setupSwagger } from '../src/app/configure-app';
import { PasswordHasherService } from '../src/auth/password-hasher.service';
import { Session } from '../src/auth/schemas/session.schema';
import { BlogPost } from '../src/blog/schemas/blog-post.schema';
import { Comment } from '../src/blog/schemas/comment.schema';
import { Like } from '../src/blog/schemas/like.schema';
import { AuditLog } from '../src/audit-logs/schemas/audit-log.schema';
import { Report } from '../src/reports/schemas/report.schema';
import { User, UserRole } from '../src/users/schemas/user.schema';

const TAG = 'paths.e2e.test';
const PASSWORD = 'TestPassword2026';

/**
 * The endpoint paths listed in the project description (section 8) work
 * and are documented; the earlier /api/blog/... addresses keep working.
 */
describe('Project-description paths (Milestone 1 release, e2e)', () => {
  let app: INestApplication<App>;
  let users: Model<User>;
  const cookies: Record<string, string[]> = {};

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    who?: string,
  ) => {
    const req = request(app.getHttpServer())[method](`/api${path}`);
    return who ? req.set('Cookie', cookies[who]) : req;
  };

  async function cleanUp() {
    const ids = (
      await users.find({ email: new RegExp(`@${TAG.replace(/\./g, '\\.')}$`) })
    ).map((u) => u._id);
    const model = (name: string) => app.get<Model<any>>(getModelToken(name));
    const posts = await model(BlogPost.name).find({ authorId: { $in: ids } });
    const postIds = posts.map((p: { _id: unknown }) => p._id);
    await model(Comment.name).deleteMany({ postId: { $in: postIds } });
    await model(Like.name).deleteMany({ postId: { $in: postIds } });
    await model(Report.name).deleteMany({ targetId: { $in: postIds } });
    await model(AuditLog.name).deleteMany({ actorId: { $in: ids } });
    await model(BlogPost.name).deleteMany({ _id: { $in: postIds } });
    await model(Session.name).deleteMany({ userId: { $in: ids } });
    await users.deleteMany({ _id: { $in: ids } });
  }

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();
    users = app.get(getModelToken(User.name));
    await users.init();
    await cleanUp();
    for (const [name, role] of [
      ['Author', UserRole.TRAVELER],
      ['Reader', UserRole.TRAVELER],
      ['Admin', UserRole.ADMIN],
    ] as const) {
      const user = await users.create({
        name,
        email: `${name.toLowerCase()}@${TAG}`,
        role,
        passwordHash: await app.get(PasswordHasherService).hash(PASSWORD),
      });
      const login = await call('post', '/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      cookies[name] = ([] as string[])
        .concat(login.headers['set-cookie'] ?? [])
        .map((cookie) => cookie.split(';')[0]);
    }
  });

  afterAll(async () => {
    await cleanUp();
    await app.close();
  });

  it('serves the blog at the documented paths and the earlier /blog ones', async () => {
    const created = await call('post', '/posts', 'Author')
      .send({
        title: 'Paths test post',
        body: 'Checking the documented routes.',
        status: 'published',
        tags: ['pathcheck'],
      })
      .expect(201);
    const id = created.body.id as string;

    await call('get', `/posts/${id}`).expect(200);
    await call('get', `/blog/posts/${id}`).expect(200);
    const tagged = await call('get', '/tags/PathCheck/posts').expect(200);
    expect(tagged.body.items.map((p: { id: string }) => p.id)).toContain(id);
    await call('get', `/tags/${'x'.repeat(31)}/posts`).expect(400);

    const comment = await call('post', `/posts/${id}/comments`, 'Reader')
      .send({ body: 'Nice post' })
      .expect(201);
    await call('patch', `/comments/${comment.body.id}`, 'Reader')
      .send({ body: 'Very nice post' })
      .expect(200);
    await call('post', `/posts/${id}/like`, 'Reader').expect(200);
    await call('get', `/posts/mine`, 'Author').expect(200);
    const authorId = (await users.findOne({ email: `author@${TAG}` }))!._id;
    await call('get', `/authors/${authorId.toString()}`).expect(200);
    await call('get', '/blog/posts/search?keyword=paths').expect(200);
  });

  it('resolves reports with PATCH /admin/reports/:id', async () => {
    const post = await call('post', '/posts', 'Author')
      .send({ title: 'Report me', body: 'Body', status: 'published' })
      .expect(201);
    const report = await call('post', '/reports', 'Reader')
      .send({ targetType: 'post', targetId: post.body.id, reason: 'Spam' })
      .expect(201);
    await call('patch', `/admin/reports/${report.body.id}`, 'Reader')
      .send({ action: 'dismiss', confirm: true })
      .expect(403);
    await call('patch', `/admin/reports/${report.body.id}`, 'Admin')
      .send({ action: 'dismiss' })
      .expect(400);
    const resolved = await call(
      'patch',
      `/admin/reports/${report.body.id}`,
      'Admin',
    )
      .send({ action: 'dismiss', confirm: true })
      .expect(200);
    expect(resolved.body.status).toBe('dismissed');
  });

  it('documents every endpoint in Swagger, without pre-filled search filters', async () => {
    const docs = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const paths = docs.body.paths as Record<
      string,
      Record<
        string,
        {
          summary?: string;
          parameters?: {
            name: string;
            in: string;
            required?: boolean;
            example?: unknown;
            schema?: { example?: unknown };
          }[];
        }
      >
    >;
    for (const required of [
      '/api/posts',
      '/api/posts/{id}',
      '/api/comments/{id}',
      '/api/tags/{tag}/posts',
      '/api/authors/{id}',
      '/api/admin/reports/{id}',
      '/api/payments/webhook',
    ])
      expect(Object.keys(paths)).toContain(required);
    expect(Object.keys(paths).some((p) => p.startsWith('/api/blog/'))).toBe(
      false,
    );

    const missingSummary: string[] = [];
    const prefilled: string[] = [];
    for (const [path, operations] of Object.entries(paths))
      for (const [method, operation] of Object.entries(operations)) {
        if (!operation.summary) missingSummary.push(`${method} ${path}`);
        for (const parameter of operation.parameters ?? [])
          if (
            parameter.in === 'query' &&
            !parameter.required &&
            parameter.name !== 'page' &&
            (parameter.example !== undefined ||
              parameter.schema?.example !== undefined)
          )
            prefilled.push(`${method} ${path} ?${parameter.name}`);
      }
    expect(missingSummary).toEqual([]);
    expect(prefilled).toEqual([]);
  });
});
