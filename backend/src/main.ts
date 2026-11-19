import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app/app.module';
import { configureApp, setupSwagger } from './app/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    // Stripe webhooks are verified against the exact request body (PAY-01).
    rawBody: true,
  });
  configureApp(app);
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
