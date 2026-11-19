import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditAction, AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { SessionsService } from '../auth/sessions.service';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

/**
 * Admin account actions: suspend and reactivate (ACC-15, ACC-16) and
 * password reset (ACC-07a). Each action is recorded in the audit log
 * (GEN-07); status changes also notify the account owner (GEN-01).
 * Administrator accounts cannot be targeted.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  /** A suspended account cannot log in and loses its open sessions. */
  async suspend(
    adminId: Types.ObjectId,
    accountId: string,
    now = new Date(),
  ): Promise<UserDocument> {
    await this.findManageableAccount(accountId);

    const updated = await this.userModel
      .findOneAndUpdate(
        { _id: accountId, status: UserStatus.ACTIVE },
        { $set: { status: UserStatus.SUSPENDED } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('Only an active account can be suspended.');
    }

    await this.sessionsService.revokeAllForUser(updated._id, now);
    await this.recordStatusChange(
      adminId,
      updated,
      AuditAction.ACCOUNT_SUSPENDED,
      'Your account has been suspended',
      'An administrator suspended your account. You cannot log in until ' +
        'it is reactivated. Your existing bookings remain valid.',
    );
    return updated;
  }

  /** Lets a suspended account log in again. */
  async reactivate(
    adminId: Types.ObjectId,
    accountId: string,
  ): Promise<UserDocument> {
    await this.findManageableAccount(accountId);

    const updated = await this.userModel
      .findOneAndUpdate(
        { _id: accountId, status: UserStatus.SUSPENDED },
        { $set: { status: UserStatus.ACTIVE } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'Only a suspended account can be reactivated.',
      );
    }

    await this.recordStatusChange(
      adminId,
      updated,
      AuditAction.ACCOUNT_REACTIVATED,
      'Your account has been reactivated',
      'An administrator reactivated your account. You can log in again.',
    );
    return updated;
  }

  /**
   * Sets a temporary password chosen by the admin. The account must choose
   * a new password at its next login, its open sessions end and any login
   * lockout is cleared.
   */
  async resetPassword(
    adminId: Types.ObjectId,
    accountId: string,
    temporaryPassword: string,
    now = new Date(),
  ): Promise<UserDocument> {
    const account = await this.findManageableAccount(accountId);

    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    const updated = await this.usersService.setPassword(
      account._id,
      passwordHash,
      true,
    );
    if (!updated) {
      throw new NotFoundException('Account not found.');
    }

    await this.sessionsService.revokeAllForUser(account._id, now);
    await this.auditLogModel.create({
      actorId: adminId,
      action: AuditAction.ACCOUNT_PASSWORD_RESET,
      targetModel: User.name,
      targetId: account._id,
    });
    return updated;
  }

  private async findManageableAccount(
    accountId: string,
  ): Promise<UserDocument> {
    const account = Types.ObjectId.isValid(accountId)
      ? await this.userModel.findById(accountId).exec()
      : null;
    if (!account) {
      throw new NotFoundException('Account not found.');
    }
    if (account.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrator accounts cannot be managed here.',
      );
    }
    return account;
  }

  private async recordStatusChange(
    adminId: Types.ObjectId,
    account: UserDocument,
    action: AuditAction,
    title: string,
    message: string,
  ): Promise<void> {
    const entry = await this.auditLogModel.create({
      actorId: adminId,
      action,
      targetModel: User.name,
      targetId: account._id,
    });
    await this.notificationModel.create({
      recipientId: account._id,
      type: NotificationType.ACCOUNT_STATUS_CHANGED,
      subjectModel: User.name,
      subjectId: account._id,
      title,
      message,
      // One notification per audited action.
      eventKey: `${action}:${entry._id.toString()}`,
    });
  }
}
