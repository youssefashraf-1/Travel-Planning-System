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
import {
  ACCESS_TOKEN_COOKIE,
  SESSION_EXPIRED_MESSAGE,
} from '../auth.constants';
import { SessionsService } from '../sessions.service';
import { AccessTokenPayload, TokenService } from '../token.service';

export interface AuthenticatedRequest extends Request {
  user: UserDocument;
  sessionId: string;
}

/**
 * Protects a route. The request must carry a valid access-token cookie whose
 * session is still open, for an existing active account. Each accepted
 * request restarts the session's 30-minute inactivity window (ACC-19).
 * The signed-in user is attached as request.user (read it with
 * @CurrentUser()). Use with @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly sessionsService: SessionsService,
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
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    // Rejects sessions that were logged out or idle for 30 minutes, and
    // otherwise extends them.
    const sessionIsOpen = await this.sessionsService.touch(
      payload.sid,
      payload.sub,
      new Date(),
    );
    if (!sessionIsOpen) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
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
    request.sessionId = payload.sid;
    return true;
  }
}
