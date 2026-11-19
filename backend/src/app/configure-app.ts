import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth.constants';

export const API_PREFIX = 'api';
export const API_DOCS_PATH = `${API_PREFIX}/docs`;

/**
 * Applies the HTTP settings shared by the running server and the e2e tests:
 * every business route lives under /api, and request bodies are validated
 * against their DTOs. Unknown fields are rejected so clients cannot set
 * server-controlled values such as a user's role.
 */
export function configureApp(app: INestApplication): void {
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
