import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { SessionsService } from '../auth/sessions.service';
import { AccountDeactivationService } from './account-deactivation.service';
import { UserStatus } from './schemas/user.schema';

describe('AccountDeactivationService (ACC-12)', () => {
  const userId = new Types.ObjectId();
  const now = new Date('2026-11-19T10:00:00Z');
  const chain = (result: unknown) => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['select', 'lean']) {
      query[method] = jest.fn(() => query);
    }
    query.exec = jest.fn().mockResolvedValue(result);
    return query;
  };

  const userModel = { findById: jest.fn(), updateOne: jest.fn() };
  const flightBookingModel = { find: jest.fn() };
  const flightModel = { exists: jest.fn() };
  const hotelBookingModel = { exists: jest.fn() };
  const passwordHasher = { verify: jest.fn() };
  const sessionsService = { revokeAllForUser: jest.fn() };
  const service = new AccountDeactivationService(
    userModel as any,
    flightBookingModel as any,
    flightModel as any,
    hotelBookingModel as any,
    passwordHasher as unknown as PasswordHasherService,
    sessionsService as unknown as SessionsService,
  );
  const dto = { currentPassword: 'travel2026', confirm: true as const };

  beforeEach(() => {
    jest.resetAllMocks();
    userModel.findById.mockReturnValue(
      chain({ _id: userId, passwordHash: 'scrypt$stored' }),
    );
    userModel.updateOne.mockReturnValue(chain({ matchedCount: 1 }));
    passwordHasher.verify.mockResolvedValue(true);
    hotelBookingModel.exists.mockResolvedValue(null);
    flightBookingModel.find.mockReturnValue(chain([]));
  });

  it('deactivates the account and ends all its sessions', async () => {
    await service.deactivateOwnAccount(userId, dto, now);

    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: userId, status: UserStatus.ACTIVE },
      { $set: { status: UserStatus.DEACTIVATED } },
    );
    expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith(userId, now);
  });

  it('rejects a wrong current password', async () => {
    passwordHasher.verify.mockResolvedValue(false);

    await expect(
      service.deactivateOwnAccount(userId, dto, now),
    ).rejects.toThrow(BadRequestException);
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });

  it('is blocked by a confirmed hotel stay that has not ended', async () => {
    hotelBookingModel.exists.mockResolvedValue({ _id: 'h1' });

    await expect(
      service.deactivateOwnAccount(userId, dto, now),
    ).rejects.toThrow(ConflictException);
    expect(hotelBookingModel.exists).toHaveBeenCalledWith({
      userId,
      status: 'confirmed',
      checkOutDate: { $gt: '2026-11-19' },
    });
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });

  it('is blocked by a confirmed flight that has not departed', async () => {
    const flightId = new Types.ObjectId();
    flightBookingModel.find.mockReturnValue(
      chain([{ segments: [{ flightId }] }]),
    );
    flightModel.exists.mockResolvedValue({ _id: flightId });

    await expect(
      service.deactivateOwnAccount(userId, dto, now),
    ).rejects.toThrow(ConflictException);
    expect(flightModel.exists).toHaveBeenCalledWith({
      _id: { $in: [flightId] },
      departureAt: { $gt: now },
    });
  });

  it('allows deactivation when confirmed flights have already departed', async () => {
    flightBookingModel.find.mockReturnValue(
      chain([{ segments: [{ flightId: new Types.ObjectId() }] }]),
    );
    flightModel.exists.mockResolvedValue(null);

    await service.deactivateOwnAccount(userId, dto, now);

    expect(userModel.updateOne).toHaveBeenCalled();
  });
});
