import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/schemas/user.schema';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  const contextFor = (role?: UserRole) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  it('allows any signed-in user when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor(UserRole.TRAVELER))).toBe(true);
  });

  it('allows a user with a required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(contextFor(UserRole.ADMIN))).toBe(true);
  });

  it.each([UserRole.TRAVELER, UserRole.HOTEL_MODERATOR, undefined])(
    'returns 403 for %p when admin is required',
    (role) => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      expect(() => guard.canActivate(contextFor(role))).toThrow(
        ForbiddenException,
      );
    },
  );
});
