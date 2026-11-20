import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, QueryFilter, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { AuditAction, AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { escapeRegExp, PAGE_SIZE, pageInfo } from '../common/pagination';
import { Hotel } from '../hotels/schemas/hotel.schema';
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
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import {
  AccountListResponseDto,
  ListAccountsQueryDto,
} from './dto/list-accounts.dto';

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
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
  ) {}

  /**
   * ACC-13: creates an airline or hotel moderator linked to one existing
   * provider. The moderator must change the temporary password on first
   * login.
   */
  async createModerator(dto: CreateModeratorDto): Promise<UserDocument> {
    const providerId = new Types.ObjectId(dto.providerId);
    const provider =
      dto.role === UserRole.AIRLINE_MODERATOR
        ? await this.airlineModel.exists({ _id: providerId })
        : await this.hotelModel.exists({ _id: providerId });
    if (!provider) {
      throw new NotFoundException(
        dto.role === UserRole.AIRLINE_MODERATOR
          ? 'Airline not found.'
          : 'Hotel not found.',
      );
    }

    return this.usersService.createModerator({
      name: dto.name,
      email: dto.email,
      passwordHash: await this.passwordHasher.hash(dto.temporaryPassword),
      role: dto.role,
      assignedProviderId: provider._id,
    });
  }

  /**
   * ACC-14: all accounts, newest first, 10 per page. Search matches part
   * of the name or email; role and status narrow the list.
   */
  async listAccounts(
    query: ListAccountsQueryDto,
  ): Promise<AccountListResponseDto> {
    const filter: QueryFilter<User> = {};
    if (query.role) {
      filter.role = query.role;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.search) {
      const pattern = new RegExp(escapeRegExp(query.search), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }

    const page = query.page ?? 1;
    const [accounts, totalItems] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return Object.assign(
      new AccountListResponseDto(),
      pageInfo(page, totalItems),
      {
        items: accounts.map((account) => UserResponseDto.fromUser(account)),
      },
    );
  }

  /** Account state, session revocation, audit and notification commit together. */
  async suspend(
    adminId: Types.ObjectId,
    accountId: string,
    now = new Date(),
  ): Promise<UserDocument> {
    return this.userModel.db.transaction(async (session) => {
      await this.findManageableAccount(accountId, session);
      const updated = await this.userModel
        .findOneAndUpdate(
          { _id: accountId, status: UserStatus.ACTIVE },
          { $set: { status: UserStatus.SUSPENDED } },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated)
        throw new ConflictException('Only an active account can be suspended.');
      await this.sessionsService.revokeAllForUser(
        updated._id,
        now,
        undefined,
        session,
      );
      await this.recordStatusChange(
        adminId,
        updated,
        AuditAction.ACCOUNT_SUSPENDED,
        'Your account has been suspended',
        'An administrator suspended your account. You cannot log in until it is reactivated. Your existing bookings remain valid.',
        session,
      );
      return updated;
    });
  }
  async reactivate(
    adminId: Types.ObjectId,
    accountId: string,
  ): Promise<UserDocument> {
    return this.userModel.db.transaction(async (session) => {
      await this.findManageableAccount(accountId, session);
      const updated = await this.userModel
        .findOneAndUpdate(
          { _id: accountId, status: UserStatus.SUSPENDED },
          { $set: { status: UserStatus.ACTIVE } },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated)
        throw new ConflictException(
          'Only a suspended account can be reactivated.',
        );
      await this.recordStatusChange(
        adminId,
        updated,
        AuditAction.ACCOUNT_REACTIVATED,
        'Your account has been reactivated',
        'An administrator reactivated your account. You can log in again.',
        session,
      );
      return updated;
    });
  }
  /** The password, session revocation and audit either all persist or all roll back. */
  async resetPassword(
    adminId: Types.ObjectId,
    accountId: string,
    temporaryPassword: string,
    now = new Date(),
  ): Promise<UserDocument> {
    await this.findManageableAccount(accountId);
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    return this.userModel.db.transaction(async (session) => {
      const account = await this.findManageableAccount(accountId, session);
      const updated = await this.usersService.setPassword(
        account._id,
        passwordHash,
        true,
        session,
      );
      if (!updated) throw new NotFoundException('Account not found.');
      await this.sessionsService.revokeAllForUser(
        account._id,
        now,
        undefined,
        session,
      );
      await this.auditLogModel.create(
        [
          {
            actorId: adminId,
            action: AuditAction.ACCOUNT_PASSWORD_RESET,
            targetModel: User.name,
            targetId: account._id,
          },
        ],
        { session },
      );
      return updated;
    });
  }

  private async findManageableAccount(
    accountId: string,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const account = Types.ObjectId.isValid(accountId)
      ? await this.userModel
          .findById(accountId)
          .session(session ?? null)
          .exec()
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
    session: ClientSession,
  ): Promise<void> {
    const [entry] = await this.auditLogModel.create(
      [
        {
          actorId: adminId,
          action,
          targetModel: User.name,
          targetId: account._id,
        },
      ],
      { session },
    );
    await this.notificationModel.create(
      [
        {
          recipientId: account._id,
          type: NotificationType.ACCOUNT_STATUS_CHANGED,
          subjectModel: User.name,
          subjectId: account._id,
          title,
          message,
          // One notification per audited action.
          eventKey: `${action}:${entry._id.toString()}`,
        },
      ],
      { session },
    );
  }
}
