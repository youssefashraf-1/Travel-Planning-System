import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };

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
      refreshToken: 'refresh-1',
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

  it('also sets the refresh token cookie, limited to /api/auth', async () => {
    authService.login.mockResolvedValue({
      user: { id: '1' },
      accessToken: 'signed.jwt',
      refreshToken: 'refresh-1',
    });
    const response = { cookie: jest.fn() };

    await controller.login(
      { email: 'a@example.com', password: 'travel2026' },
      response as any,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-1',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/auth',
      }),
    );
  });

  it('refuses to refresh without a refresh cookie', async () => {
    await expect(
      controller.refresh({ cookies: {} } as any, { cookie: jest.fn() } as any),
    ).rejects.toThrow('Your session has expired. Please log in again.');
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it('revokes the session before clearing both cookies at logout', async () => {
    const calls: string[] = [];
    authService.logout.mockImplementation(async () => {
      calls.push('revoke');
    });
    const response = {
      clearCookie: jest.fn((name: string) => calls.push(`clear ${name}`)),
    };

    await controller.logout(
      { cookies: { access_token: 'a', refresh_token: 'r' } } as any,
      response as any,
    );

    expect(authService.logout).toHaveBeenCalledWith({
      accessToken: 'a',
      refreshToken: 'r',
    });
    expect(calls).toEqual([
      'revoke',
      'clear access_token',
      'clear refresh_token',
    ]);
    expect(response.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/api/auth', httpOnly: true }),
    );
  });
});
