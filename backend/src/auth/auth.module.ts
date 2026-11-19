import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordHasherService } from './password-hasher.service';
import { Session, SessionSchema } from './schemas/session.schema';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

@Module({
  // The JWT secret is passed per call by TokenService (see token.service.ts).
  imports: [
    forwardRef(() => UsersModule),
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasherService,
    TokenService,
    SessionsService,
    JwtAuthGuard,
  ],
  // Feature modules that protect routes import AuthModule and use
  // @UseGuards(JwtAuthGuard) with @CurrentUser().
  exports: [
    PasswordHasherService,
    TokenService,
    SessionsService,
    JwtAuthGuard,
    UsersModule,
  ],
})
export class AuthModule {}
