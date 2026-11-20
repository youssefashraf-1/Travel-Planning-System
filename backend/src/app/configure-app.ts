import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth.constants';
import {
  UPLOADS_URL_PREFIX,
  uploadsDirectory,
} from '../common/uploads/image-uploads.service';

export const API_PREFIX = 'api';
export const API_DOCS_PATH = `${API_PREFIX}/docs`;

/**
 * Applies the HTTP settings shared by the running server and the e2e tests:
 * every business route lives under /api, and request bodies are validated
 * against their DTOs. Unknown fields are rejected so clients cannot set
 * server-controlled values such as a user's role.
 */
export function configureApp(app: INestApplication): void {
  // Blog routes follow the project description (/api/posts, /api/comments,
  // /api/authors). The earlier /api/blog/... addresses keep working.
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (req.url.startsWith(`/${API_PREFIX}/blog/`))
      req.url = `/${API_PREFIX}/${req.url.slice(API_PREFIX.length + 7)}`;
    next();
  });

  // GEN-08: uploaded images are served by URL. nosniff stops browsers from
  // treating an image as anything else.
  (app as NestExpressApplication).useStaticAssets(uploadsDirectory(), {
    prefix: UPLOADS_URL_PREFIX,
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  // Reads the HttpOnly login cookie on incoming requests.
  app.use(cookieParser());

  app.setGlobalPrefix(API_PREFIX, {
    // Keep the existing GET / health response outside the API prefix.
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

/** Serves the Swagger UI at /api/docs. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('GIU Travel Planning and Booking Management System API')
    .setDescription(
      'Backend API. Endpoint descriptions reference the requirement IDs ' +
        'from the official project workbook.',
    )
    .setVersion('0.0.1')
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(API_DOCS_PATH, app, document);
}
