import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditAction } from '../audit-logs/schemas/audit-log.schema';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { SessionsService } from '../auth/sessions.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { UserRole, UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AdminAccountsService } from './admin-accounts.service';

describe('AdminAccountsService', () => {
  const adminId = new Types.ObjectId();
  const accountId = new Types.ObjectId();
  const now = new Date('2026-11-19T10:00:00Z');
  const exec = (result: unknown) => ({
    exec: jest.fn().mockResolvedValue(result),
  });

  const userModel = { findById: jest.fn(), findOneAndUpdate: jest.fn() };
  const auditLogModel = { create: jest.fn() };
  const notificationModel = { create: jest.fn() };
  const usersService = { setPassword: jest.fn() };
  const sessionsService = { revokeAllForUser: jest.fn() };
  const passwordHasher = { hash: jest.fn() };
  const service = new AdminAccountsService(
    userModel as any,
    auditLogModel as any,
    notificationModel as any,
    usersService as unknown as UsersService,
    sessionsService as unknown as SessionsService,
    passwordHasher as unknown as PasswordHasherService,
  );

  const account = (overrides: Record<string, unknown> = {}) => ({
    _id: accountId,
    role: UserRole.TRAVELER,
    status: UserStatus.ACTIVE,
    ...overrides,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    userModel.findById.mockReturnValue(exec(account()));
    auditLogModel.create.mockResolvedValue({ _id: new Types.ObjectId() });
  });

  describe('suspend (ACC-15, ACC-16)', () => {
    it('suspends, ends sessions, audits and notifies the owner', async () => {
      userModel.findOneAndUpdate.mockReturnValue(
        exec(account({ status: UserStatus.SUSPENDED })),
      );

      const result = await service.suspend(adminId, accountId.toString(), now);

      expect(result.status).toBe(UserStatus.SUSPENDED);
      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: accountId.toString(), status: UserStatus.ACTIVE },
        { $set: { status: UserStatus.SUSPENDED } },
        { new: true },
      );
      expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith(
        accountId,
        now,
      );
      expect(auditLogModel.create).toHaveBeenCalledWith({
        actorId: adminId,
        action: AuditAction.ACCOUNT_SUSPENDED,
        targetModel: 'User',
        targetId: accountId,
      });
      expect(notificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: accountId,
          type: NotificationType.ACCOUNT_STATUS_CHANGED,
          subjectModel: 'User',
        }),
      );
    });

    it('returns 409 when the account is not active', async () => {
      userModel.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(
        service.suspend(adminId, accountId.toString(), now),
      ).rejects.toThrow(ConflictException);
      expect(auditLogModel.create).not.toHaveBeenCalled();
    });

    it('refuses to suspend an administrator', async () => {
      userModel.findById.mockReturnValue(
        exec(account({ role: UserRole.ADMIN })),
      );

      await expect(
        service.suspend(adminId, accountId.toString(), now),
      ).rejects.toThrow(ForbiddenException);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown or malformed id', async () => {
      userModel.findById.mockReturnValue(exec(null));

      await expect(
        service.suspend(adminId, accountId.toString(), now),
      ).rejects.toThrow(NotFoundException);
      await expect(service.suspend(adminId, 'nope', now)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivate', () => {
    it('reactivates a suspended account, audits and notifies', async () => {
      userModel.findOneAndUpdate.mockReturnValue(exec(account()));

      await service.reactivate(adminId, accountId.toString());

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: accountId.toString(), status: UserStatus.SUSPENDED },
        { $set: { status: UserStatus.ACTIVE } },
        { new: true },
      );
      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.ACCOUNT_REACTIVATED }),
      );
      expect(notificationModel.create).toHaveBeenCalled();
    });

    it('returns 409 when the account is not suspended', async () => {
      userModel.findOneAndUpdate.mockReturnValue(exec(null));

      await expect(
        service.reactivate(adminId, accountId.toString()),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resetPassword (ACC-07a)', () => {
    it('stores a temporary password that must be changed and audits it', async () => {
      passwordHasher.hash.mockResolvedValue('scrypt$temp');
      usersService.setPassword.mockResolvedValue(
        account({ mustChangePassword: true }),
      );

      const result = await service.resetPassword(
        adminId,
        accountId.toString(),
        'Temp2026pass',
        now,
      );

      expect(usersService.setPassword).toHaveBeenCalledWith(
        accountId,
        'scrypt$temp',
        true,
      );
      expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith(
        accountId,
        now,
      );
      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ACCOUNT_PASSWORD_RESET,
          targetId: accountId,
        }),
      );
      expect(result.mustChangePassword).toBe(true);
    });

    it('refuses to reset an administrator password', async () => {
      userModel.findById.mockReturnValue(
        exec(account({ role: UserRole.ADMIN })),
      );

      await expect(
        service.resetPassword(adminId, accountId.toString(), 'Temp2026pass'),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });
  });
});
