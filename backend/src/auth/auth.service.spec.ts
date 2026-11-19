import {
  ForbiddenException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AuthService, INVALID_CREDENTIALS_MESSAGE } from './auth.service';
import { PasswordHasherService } from './password-hasher.service';
import { TokenService } from './token.service';

describe('AuthService', () => {
  const usersService = {
    createTraveler: jest.fn(),
    findByEmail: jest.fn(),
    recordFailedLogin: jest.fn(),
    resetFailedLogins: jest.fn(),
  };
  const passwordHasher = { hash: jest.fn(), verify: jest.fn() };
  const tokenService = { signAccessToken: jest.fn() };
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
    service = new AuthService(
      usersService as unknown as UsersService,
      passwordHasher as unknown as PasswordHasherService,
      tokenService as unknown as TokenService,
    );
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
        createdAt: now,
      });
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
      expect(result.accessToken).toBe('signed.jwt');
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
});
