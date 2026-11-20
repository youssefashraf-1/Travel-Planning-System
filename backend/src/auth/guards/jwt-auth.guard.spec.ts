import {
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { SessionsService } from '../sessions.service';
import { TokenService } from '../token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const tokenService = { verifyAccessToken: jest.fn() };
  const sessionsService = { touch: jest.fn() };
  const usersService = { findById: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new JwtAuthGuard(
    tokenService as unknown as TokenService,
    sessionsService as unknown as SessionsService,
    usersService as unknown as UsersService,
    reflector as unknown as Reflector,
  );

  function contextWith(cookies?: Record<string, string>) {
    const request: Record<string, unknown> = { cookies };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    return { context, request };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    sessionsService.touch.mockResolvedValue(true);
  });

  it('attaches the active user for a valid token cookie', async () => {
    const user = { _id: 'u1', status: UserStatus.ACTIVE };
    tokenService.verifyAccessToken.mockResolvedValue({ sub: 'u1', sid: 's1' });
    usersService.findById.mockResolvedValue(user);
    const { context, request } = contextWith({ access_token: 'good' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('good');
    expect(sessionsService.touch).toHaveBeenCalledWith(
      's1',
      'u1',
      expect.any(Date),
    );
    expect(request.user).toBe(user);
    expect(request.sessionId).toBe('s1');
  });

  it('returns 401 when the session was logged out or idle for 30 minutes', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({ sub: 'u1', sid: 's1' });
    sessionsService.touch.mockResolvedValue(false);

    await expect(
      guard.canActivate(contextWith({ access_token: 'x' }).context),
    ).rejects.toThrow(UnauthorizedException);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('returns 401 without a cookie', async () => {
    await expect(guard.canActivate(contextWith().context)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(guard.canActivate(contextWith({}).context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('returns 401 for an invalid or expired token', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new Error('jwt expired'));

    await expect(
      guard.canActivate(contextWith({ access_token: 'old' }).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('keeps a server configuration error as 500', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(
      new InternalServerErrorException(),
    );

    await expect(
      guard.canActivate(contextWith({ access_token: 'x' }).context),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('returns 401 when the account no longer exists', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({ sub: 'gone' });
    usersService.findById.mockResolvedValue(null);

    await expect(
      guard.canActivate(contextWith({ access_token: 'x' }).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns 403 when the account was suspended after login', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({ sub: 'u1' });
    usersService.findById.mockResolvedValue({
      _id: 'u1',
      status: UserStatus.SUSPENDED,
    });

    await expect(
      guard.canActivate(contextWith({ access_token: 'x' }).context),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('temporary password (ACC-07a)', () => {
    const pendingUser = {
      _id: 'u1',
      status: UserStatus.ACTIVE,
      mustChangePassword: true,
    };

    beforeEach(() => {
      tokenService.verifyAccessToken.mockResolvedValue({
        sub: 'u1',
        sid: 's1',
      });
      usersService.findById.mockResolvedValue(pendingUser);
    });

    it('returns 403 on ordinary routes until the password is changed', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);

      await expect(
        guard.canActivate(contextWith({ access_token: 'x' }).context),
      ).rejects.toThrow(
        'You must change your temporary password before continuing.',
      );
    });

    it('allows routes marked @AllowPendingPasswordChange()', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      await expect(
        guard.canActivate(contextWith({ access_token: 'x' }).context),
      ).resolves.toBe(true);
    });
  });
});
