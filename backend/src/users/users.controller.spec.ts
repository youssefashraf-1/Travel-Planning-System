import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  const usersService = { updateProfile: jest.fn() };
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
      providers: [{ provide: UsersService, useValue: usersService }],
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
});
