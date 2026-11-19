import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../users/schemas/user.schema';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';

/** What a signed access token says about its holder. */
export interface AccessTokenPayload {
  /** The user's id. */
  sub: string;
  role: UserRole;
}

const MIN_SECRET_LENGTH = 32;

/**
 * Signs and checks JWT access tokens (ACC-04). The secret is read when a
 * token is used, not at startup, so a teammate without JWT_ACCESS_SECRET can
 * still run the rest of the backend.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccessToken(user: {
    _id: { toString(): string };
    role: UserRole;
  }): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user._id.toString(),
      role: user.role,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.secret(),
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /** Rejects tokens that are expired, tampered with, or signed elsewhere. */
  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: this.secret(),
      algorithms: ['HS256'],
    });
  }

  private secret(): string {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      this.logger.error(
        `JWT_ACCESS_SECRET must be set in .env with at least ` +
          `${MIN_SECRET_LENGTH} characters (see .env.example).`,
      );
      throw new InternalServerErrorException(
        'Login is not configured on this server.',
      );
    }
    return secret;
  }
}
