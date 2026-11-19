import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserDocument, UserStatus } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { AccessTokenPayload, TokenService } from '../token.service';

export interface AuthenticatedRequest extends Request {
  user: UserDocument;
}

/**
 * Protects a route: the request must carry a valid access-token cookie for an
 * existing, active account. The signed-in user is attached as request.user
 * (read it with @CurrentUser()). Use with @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[
      ACCESS_TOKEN_COOKIE
    ];
    if (!token) {
      throw new UnauthorizedException('Please log in.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokenService.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new UnauthorizedException(
        'Your session is invalid or has expired. Please log in again.',
      );
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Please log in.');
    }
    // A suspended or deactivated account loses access immediately.
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`This account is ${user.status}.`);
    }

    request.user = user;
    return true;
  }
}
