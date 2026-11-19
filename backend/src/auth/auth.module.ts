import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordHasherService } from './password-hasher.service';
import { TokenService } from './token.service';

@Module({
  // The JWT secret is passed per call by TokenService (see token.service.ts).
  imports: [UsersModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordHasherService, TokenService, JwtAuthGuard],
  // Feature modules that protect routes import AuthModule and use
  // @UseGuards(JwtAuthGuard) with @CurrentUser().
  exports: [PasswordHasherService, TokenService, JwtAuthGuard, UsersModule],
})
export class AuthModule {}
