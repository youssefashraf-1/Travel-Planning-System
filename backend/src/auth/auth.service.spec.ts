import {
  ForbiddenException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AccountTokensService } from './account-tokens.service';
import { MailService } from '../common/mail/mail.service';
import { AuthService, INVALID_CREDENTIALS_MESSAGE } from './auth.service';
import { PasswordHasherService } from './password-hasher.service';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

describe('AuthService', () => {
  const accountTokens = { issue: jest.fn(), consume: jest.fn() };
  const mail = {
    send: jest.fn(),
    apiUrl: () => 'http://api.test',
    frontendUrl: () => 'http://app.test',
  };
  const usersService = {
    createTraveler: jest.fn(),
    findById: jest.fn(),
    setPassword: jest.fn(),
    findByEmail: jest.fn(),
    recordFailedLogin: jest.fn(),
    resetFailedLogins: jest.fn(),
  };
  const passwordHasher = { hash: jest.fn(), verify: jest.fn() };
  const tokenService = {
    signAccessToken: jest.fn(),
    verifyAccessToken: jest.fn(),
  };
  const sessionsService = {
    create: jest.fn(),
    revokeAllForUser: jest.fn(),
    rotate: jest.fn(),
    revokeById: jest.fn(),
    revokeByRefreshToken: jest.fn(),
  };
  const sessionId = new Types.ObjectId();
  let service: AuthService;

  const now = new Date('2026-11-19T10:00:00Z');
  const id = new Types.ObjectId();
  const storedUser = (overrides: Record<string, unknown> = {}) => ({
    _id: id,
    name: 'Mona Hassan',
    email: 'mona.hassan@example.com',
    passwordHash: 'scrypt$stored',
    role: UserRole.TRAVELER,
    status: UserStatus.ACTIVE,
    failedLoginAttempts: 0,
    mustChangePassword: false,
    createdAt: now,
    ...overrides,
  });
  const credentials = {
    email: 'mona.hassan@example.com',
    password: 'travel2026',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    accountTokens.issue.mockResolvedValue('token-1');
    service = new AuthService(
      usersService as unknown as UsersService,
      passwordHasher as unknown as PasswordHasherService,
      tokenService as unknown as TokenService,
      sessionsService as unknown as SessionsService,
      accountTokens as unknown as AccountTokensService,
      mail as unknown as MailService,
    );
    sessionsService.create.mockResolvedValue({
      session: { _id: sessionId, id: sessionId.toString() },
      refreshToken: 'refresh-1',
    });
  });

  describe('register (ACC-01)', () => {
    it('hashes the password, records consent and returns safe fields', async () => {
      passwordHasher.hash.mockResolvedValue('scrypt$hash');
      usersService.createTraveler.mockResolvedValue(storedUser());

      const result = await service.register({
        name: 'Mona Hassan',
        email: 'mona.hassan@example.com',
        password: 'travel2026',
        acceptTermsAndPrivacy: true,
      });

      expect(passwordHasher.hash).toHaveBeenCalledWith('travel2026');
      const saved = usersService.createTraveler.mock.calls[0][0];
      expect(saved.passwordHash).toBe('scrypt$hash');
      expect(saved).not.toHaveProperty('password');
      expect(saved.termsAndPrivacyAcceptedAt).toBeInstanceOf(Date);
      expect(result).toEqual({
        id: id.toString(),
        name: 'Mona Hassan',
        email: 'mona.hassan@example.com',
        role: UserRole.TRAVELER,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        emailVerified: true,
        createdAt: now,
      });
      // ACC-02: a verification link is emailed after registration.
      expect(accountTokens.issue).toHaveBeenCalledWith(
        id,
        'email_verification',
        24 * 60,
      );
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'mona.hassan@example.com',
          text: expect.stringContaining(
            'http://api.test/api/auth/verify-email?token=token-1',
          ),
        }),
      );
    });
  });

  describe('login (ACC-04, ACC-05)', () => {
    it('returns the user and a signed token for correct credentials', async () => {
      usersService.findByEmail.mockResolvedValue(storedUser());
      passwordHasher.verify.mockResolvedValue(true);
      tokenService.signAccessToken.mockResolvedValue('signed.jwt');

      const result = await service.login(credentials, now);

      expect(usersService.findByEmail).toHaveBeenCalledWith(credentials.email, {
        includePasswordHash: true,
      });
      expect(passwordHasher.verify).toHaveBeenCalledWith(
        'travel2026',
        'scrypt$stored',
      );
      expect(sessionsService.create).toHaveBeenCalledWith(id, now);
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ _id: id }),
        sessionId,
      );
      expect(result.accessToken).toBe('signed.jwt');
      expect(result.refreshToken).toBe('refresh-1');
      expect(result.user.id).toBe(id.toString());
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(usersService.resetFailedLogins).not.toHaveBeenCalled();
    });

    it('resets earlier failures after a successful login', async () => {
      usersService.findByEmail.mockResolvedValue(
        storedUser({ failedLoginAttempts: 3 }),
      );
      passwordHasher.verify.mockResolvedValue(true);

      await service.login(credentials, now);

      expect(usersService.resetFailedLogins).toHaveBeenCalledWith(id);
    });

    it('gives the same 401 for an unknown email, after hashing work', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      passwordHasher.hash.mockResolvedValue('scrypt$dummy');
      passwordHasher.verify.mockResolvedValue(false);

      await expect(service.login(credentials, now)).rejects.toThrow(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(passwordHasher.verify).toHaveBeenCalledWith(
        'travel2026',
        'scrypt$dummy',
      );
    });

    it('counts a wrong password and returns 401', async () => {
      usersService.findByEmail.mockResolvedValue(storedUser());
      passwordHasher.verify.mockResolvedValue(false);
      usersService.recordFailedLogin.mockResolvedValue({});

      await expect(service.login(credentials, now)).rejects.toThrow(
        new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE),
      );
      expect(usersService.recordFailedLogin).toHaveBeenCalledWith(
        id,
        now,
        5,
        15,
      );
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    });

    it('returns 423 when the failure locks the account', async () => {
      usersService.findByEmail.mockResolvedValue(
        storedUser({ failedLoginAttempts: 4 }),
      );
      passwordHasher.verify.mockResolvedValue(false);
      usersService.recordFailedLogin.mockResolvedValue({
        lockedUntil: new Date(now.getTime() + 15 * 60_000),
      });

      await expect(service.login(credentials, now)).rejects.toMatchObject({
        status: HttpStatus.LOCKED,
        message: 'Too many failed login attempts. Try again in 15 minute(s).',
      });
    });

    it('rejects a locked account even with the right password', async () => {
      usersService.findByEmail.mockResolvedValue(
        storedUser({ lockedUntil: new Date(now.getTime() + 5 * 60_000) }),
      );

      await expect(service.login(credentials, now)).rejects.toMatchObject({
        status: HttpStatus.LOCKED,
      });
      expect(passwordHasher.verify).not.toHaveBeenCalled();
    });

    it('allows login once the lock has expired', async () => {
      usersService.findByEmail.mockResolvedValue(
        storedUser({ lockedUntil: new Date(now.getTime() - 1000) }),
      );
      passwordHasher.verify.mockResolvedValue(true);
      tokenService.signAccessToken.mockResolvedValue('signed.jwt');

      await expect(service.login(credentials, now)).resolves.toMatchObject({
        accessToken: 'signed.jwt',
      });
      expect(usersService.resetFailedLogins).toHaveBeenCalledWith(id);
    });

    it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
      'returns 403 for a %s account with the right password',
      async (status) => {
        usersService.findByEmail.mockResolvedValue(storedUser({ status }));
        passwordHasher.verify.mockResolvedValue(true);

        await expect(service.login(credentials, now)).rejects.toThrow(
          new ForbiddenException(`This account is ${status}.`),
        );
        expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      },
    );
  });

  describe('refresh (ACC-19)', () => {
    const renewedSession = {
      session: { _id: sessionId, id: sessionId.toString(), userId: id },
      refreshToken: 'refresh-2',
    };

    it('rotates the refresh token and issues a new access token', async () => {
      sessionsService.rotate.mockResolvedValue(renewedSession);
      usersService.findById.mockResolvedValue(storedUser());
      tokenService.signAccessToken.mockResolvedValue('signed.jwt.2');

      const result = await service.refresh('refresh-1', now);

      expect(sessionsService.rotate).toHaveBeenCalledWith('refresh-1', now);
      expect(result).toMatchObject({
        accessToken: 'signed.jwt.2',
        refreshToken: 'refresh-2',
      });
      expect(result.user.id).toBe(id.toString());
    });

    it('returns 401 when the session is expired, revoked or unknown', async () => {
      sessionsService.rotate.mockResolvedValue(null);

      await expect(service.refresh('old', now)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('ends the session and returns 403 for a suspended account', async () => {
      sessionsService.rotate.mockResolvedValue(renewedSession);
      usersService.findById.mockResolvedValue(
        storedUser({ status: UserStatus.SUSPENDED }),
      );

      await expect(service.refresh('refresh-1', now)).rejects.toThrow(
        ForbiddenException,
      );
      expect(sessionsService.revokeById).toHaveBeenCalledWith(
        sessionId.toString(),
        now,
      );
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('logout (ACC-06)', () => {
    it('revokes the session found through either cookie', async () => {
      tokenService.verifyAccessToken.mockResolvedValue({ sid: 's1' });

      await service.logout(
        { refreshToken: 'refresh-1', accessToken: 'signed.jwt' },
        now,
      );

      expect(sessionsService.revokeByRefreshToken).toHaveBeenCalledWith(
        'refresh-1',
        now,
      );
      expect(sessionsService.revokeById).toHaveBeenCalledWith('s1', now);
    });

    it('does nothing harmful without cookies or with a bad token', async () => {
      tokenService.verifyAccessToken.mockRejectedValue(new Error('expired'));

      await expect(service.logout({}, now)).resolves.toBeUndefined();
      await expect(
        service.logout({ accessToken: 'expired' }, now),
      ).resolves.toBeUndefined();
      expect(sessionsService.revokeById).not.toHaveBeenCalled();
    });
  });

  describe('changePassword (ACC-08)', () => {
    const change = {
      currentPassword: 'travel2026',
      newPassword: 'journey2027',
    };

    beforeEach(() => {
      usersService.findById.mockResolvedValue(
        storedUser({ mustChangePassword: true }),
      );
    });

    it('stores the new hash, clears the reset flag and ends other sessions', async () => {
      passwordHasher.verify
        .mockResolvedValueOnce(true) // current password matches
        .mockResolvedValueOnce(false); // new password differs
      passwordHasher.hash.mockResolvedValue('scrypt$new');

      await service.changePassword(id, 's1', change, now);

      expect(usersService.findById).toHaveBeenCalledWith(id.toString(), {
        includePasswordHash: true,
      });
      expect(usersService.setPassword).toHaveBeenCalledWith(
        id,
        'scrypt$new',
        false,
      );
      expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith(
        id,
        now,
        's1',
      );
    });

    it('rejects a wrong current password', async () => {
      passwordHasher.verify.mockResolvedValue(false);

      await expect(
        service.changePassword(id, 's1', change, now),
      ).rejects.toThrow('The current password is incorrect.');
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });

    it('rejects reusing the current password', async () => {
      passwordHasher.verify.mockResolvedValue(true);

      await expect(
        service.changePassword(id, 's1', change, now),
      ).rejects.toThrow(
        'The new password must be different from the current password.',
      );
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });
  });
});
