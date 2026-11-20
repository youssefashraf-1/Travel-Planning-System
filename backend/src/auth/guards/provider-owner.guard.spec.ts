import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { UserRole } from '../../users/schemas/user.schema';
import { ProviderType } from '../access';
import { ProviderOwnerGuard } from './provider-owner.guard';

describe('ProviderOwnerGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new ProviderOwnerGuard(reflector as unknown as Reflector);
  const hotelId = new Types.ObjectId();
  const moderator = {
    _id: new Types.ObjectId(),
    role: UserRole.HOTEL_MODERATOR,
    assignedProviderId: hotelId,
  };

  const contextWith = (params: Record<string, string>) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: moderator, params }),
      }),
    }) as unknown as ExecutionContext;

  it('does nothing on routes without @ManagesProvider()', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  it('reads the named route parameter', () => {
    reflector.getAllAndOverride.mockReturnValue({
      type: ProviderType.HOTEL,
      param: 'hotelId',
    });

    expect(
      guard.canActivate(contextWith({ hotelId: hotelId.toString() })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        contextWith({ hotelId: new Types.ObjectId().toString() }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('returns 404 for a malformed or missing id', () => {
    reflector.getAllAndOverride.mockReturnValue({
      type: ProviderType.HOTEL,
      param: 'id',
    });

    expect(() => guard.canActivate(contextWith({ id: 'abc' }))).toThrow(
      NotFoundException,
    );
    expect(() => guard.canActivate(contextWith({}))).toThrow(NotFoundException);
  });
});
