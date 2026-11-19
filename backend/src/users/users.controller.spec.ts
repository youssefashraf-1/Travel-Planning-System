import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountDeactivationService } from './account-deactivation.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = { updateProfile: jest.fn() };
  const accountDeactivation = { deactivateOwnAccount: jest.fn() };
  const user = {
    _id: { toString: () => 'u1' },
    name: 'Mona Hassan',
    email: 'mona@example.com',
    passwordHash: 'scrypt$secret',
    role: 'traveler',
    status: 'active',
    mustChangePassword: false,
    phone: '+20 100 123 4567',
    preferredCurrency: 'EGP',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        {
          provide: AccountDeactivationService,
          useValue: accountDeactivation,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('returns the signed-in user’s profile without secrets', () => {
    const profile = controller.getMyProfile(user as any);

    expect(profile).toMatchObject({
      id: 'u1',
      phone: '+20 100 123 4567',
      preferredCurrency: 'EGP',
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('updates only the signed-in user', async () => {
    usersService.updateProfile.mockResolvedValue({ ...user, name: 'Mona H.' });

    const profile = await controller.updateMyProfile(user as any, {
      name: 'Mona H.',
    });

    expect(usersService.updateProfile).toHaveBeenCalledWith(user._id, {
      name: 'Mona H.',
    });
    expect(profile.name).toBe('Mona H.');
  });

  it('deactivates the signed-in account and clears the cookies', async () => {
    const response = { clearCookie: jest.fn() };
    const body = { currentPassword: 'travel2026', confirm: true };

    await controller.deactivateMyAccount(user as any, body, response as any);

    expect(accountDeactivation.deactivateOwnAccount).toHaveBeenCalledWith(
      user._id,
      body,
    );
    expect(response.clearCookie).toHaveBeenCalledTimes(2);
  });

  it('keeps the cookies when deactivation is refused', async () => {
    accountDeactivation.deactivateOwnAccount.mockRejectedValue(
      new Error('upcoming bookings'),
    );
    const response = { clearCookie: jest.fn() };

    await expect(
      controller.deactivateMyAccount(
        user as any,
        { currentPassword: 'travel2026', confirm: true },
        response as any,
      ),
    ).rejects.toThrow('upcoming bookings');
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});
