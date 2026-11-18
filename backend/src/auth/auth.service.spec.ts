import { Types } from 'mongoose';
import { UserRole, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { PasswordHasherService } from './password-hasher.service';

describe('AuthService', () => {
  const usersService = { createTraveler: jest.fn() };
  const passwordHasher = { hash: jest.fn() };
  const service = new AuthService(
    usersService as unknown as UsersService,
    passwordHasher as unknown as PasswordHasherService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('hashes the password, records consent and returns safe fields', async () => {
    const id = new Types.ObjectId();
    const createdAt = new Date('2026-11-18T10:00:00Z');
    passwordHasher.hash.mockResolvedValue('scrypt$hash');
    usersService.createTraveler.mockResolvedValue({
      _id: id,
      name: 'Mona Hassan',
      email: 'mona.hassan@example.com',
      passwordHash: 'scrypt$hash',
      role: UserRole.TRAVELER,
      status: UserStatus.ACTIVE,
      createdAt,
    });

    const before = Date.now();
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
    expect(saved.termsAndPrivacyAcceptedAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(result).toEqual({
      id: id.toString(),
      name: 'Mona Hassan',
      email: 'mona.hassan@example.com',
      role: UserRole.TRAVELER,
      status: UserStatus.ACTIVE,
      createdAt,
    });
    expect(result).not.toHaveProperty('passwordHash');
  });
});
