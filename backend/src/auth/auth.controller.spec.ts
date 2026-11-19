import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = { register: jest.fn(), login: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('passes the registration to AuthService', async () => {
    const body = {
      name: 'Mona Hassan',
      email: 'mona.hassan@example.com',
      password: 'travel2026',
      acceptTermsAndPrivacy: true,
    };
    authService.register.mockResolvedValue({ id: '1' });

    await expect(controller.register(body)).resolves.toEqual({ id: '1' });
    expect(authService.register).toHaveBeenCalledWith(body);
  });

  it('sets the token in an HttpOnly cookie and returns only the user', async () => {
    const credentials = {
      email: 'mona.hassan@example.com',
      password: 'travel2026',
    };
    authService.login.mockResolvedValue({
      user: { id: '1' },
      accessToken: 'signed.jwt',
    });
    const response = { cookie: jest.fn() };

    const result = await controller.login(credentials, response as any);

    expect(result).toEqual({ id: '1' });
    expect(response.cookie).toHaveBeenCalledWith(
      'access_token',
      'signed.jwt',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api',
        maxAge: 15 * 60 * 1000,
      }),
    );
  });
});
