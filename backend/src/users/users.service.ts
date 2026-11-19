import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Currency } from '../reference-data/schemas/currency.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User, UserDocument, UserRole } from './schemas/user.schema';

export interface CreateModeratorInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole.AIRLINE_MODERATOR | UserRole.HOTEL_MODERATOR;
  assignedProviderId: Types.ObjectId;
}

export interface CreateTravelerInput {
  name: string;
  email: string;
  passwordHash: string;
  termsAndPrivacyAcceptedAt: Date;
}

const MONGO_DUPLICATE_KEY_ERROR = 11000;

/** Lowercases and trims an email the same way the User schema stores it. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Currency.name)
    private readonly currencyModel: Model<Currency>,
  ) {}

  /**
   * Creates a self-registered traveler account (ACC-01). The role is always
   * set here, never taken from the request. The unique email index decides
   * duplicates, so two simultaneous registrations cannot both succeed.
   */
  async createTraveler(input: CreateTravelerInput): Promise<UserDocument> {
    try {
      return await this.userModel.create({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        role: UserRole.TRAVELER,
        termsAndPrivacyAcceptedAt: input.termsAndPrivacyAcceptedAt,
      });
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  }

  /**
   * Creates a moderator account (ACC-13). The moderator must change the
   * temporary password on first login.
   */
  async createModerator(input: CreateModeratorInput): Promise<UserDocument> {
    try {
      return await this.userModel.create({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        role: input.role,
        assignedProviderId: input.assignedProviderId,
        mustChangePassword: true,
      });
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw error;
    }
  }

  /**
   * Finds an account by email. The password hash stays hidden unless a
   * caller such as login explicitly asks for it.
   */
  async findByEmail(
    email: string,
    options: { includePasswordHash?: boolean } = {},
  ): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: normalizeEmail(email) });
    if (options.includePasswordHash) {
      query.select('+passwordHash');
    }
    return query.exec();
  }

  async findById(
    id: string,
    options: { includePasswordHash?: boolean } = {},
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const query = this.userModel.findById(id);
    if (options.includePasswordHash) {
      query.select('+passwordHash');
    }
    return query.exec();
  }

  /**
   * Stores a new password hash (ACC-07a, ACC-08). It also clears any login
   * lockout. mustChangePassword is true after an admin reset, so the user
   * has to pick their own password at the next login.
   */
  async setPassword(
    userId: Types.ObjectId,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          $set: { passwordHash, mustChangePassword, failedLoginAttempts: 0 },
          $unset: { lockedUntil: 1 },
        },
        { new: true },
      )
      .exec();
  }

  /**
   * ACC-05: counts one failed login. On the fifth consecutive failure the
   * account is locked until `now + lockoutMinutes` and the counter restarts.
   * It runs as a single atomic update, so simultaneous wrong attempts are
   * all counted. Returns the lock expiry if this failure locked the account.
   */
  async recordFailedLogin(
    userId: Types.ObjectId,
    now: Date,
    maxAttempts: number,
    lockoutMinutes: number,
  ): Promise<{ lockedUntil?: Date }> {
    const lockedUntil = new Date(now.getTime() + lockoutMinutes * 60_000);
    const reachedLimit = {
      $gte: [{ $add: ['$failedLoginAttempts', 1] }, maxAttempts],
    };

    const updated = await this.userModel
      .findOneAndUpdate(
        { _id: userId },
        [
          {
            $set: {
              lockedUntil: {
                $cond: [reachedLimit, lockedUntil, '$lockedUntil'],
              },
              failedLoginAttempts: {
                $cond: [reachedLimit, 0, { $add: ['$failedLoginAttempts', 1] }],
              },
            },
          },
        ],
        { new: true, updatePipeline: true },
      )
      .exec();

    const isNewLock = updated?.lockedUntil?.getTime() === lockedUntil.getTime();
    return isNewLock ? { lockedUntil } : {};
  }

  /** ACC-05: a successful login clears the failure counter and any lock. */
  async resetFailedLogins(userId: Types.ObjectId): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: userId },
        { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } },
      )
      .exec();
  }

  /**
   * ACC-09: updates name, phone and preferred currency together. Every field
   * is validated first (the DTO checks formats, this checks the currency
   * against the seeded list), so nothing is saved if any field is invalid.
   * null removes phone or currency.
   */
  async updateProfile(
    userId: Types.ObjectId,
    changes: UpdateProfileDto,
  ): Promise<UserDocument> {
    const set: Partial<Pick<User, 'name' | 'phone' | 'preferredCurrency'>> = {};
    const unset: Record<string, 1> = {};

    if (changes.name !== undefined) {
      set.name = changes.name;
    }
    for (const field of ['phone', 'preferredCurrency'] as const) {
      const value = changes[field];
      if (value === null) {
        unset[field] = 1;
      } else if (value !== undefined) {
        set[field] = value;
      }
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
      throw new BadRequestException(
        'Provide at least one of name, phone or preferredCurrency.',
      );
    }

    if (set.preferredCurrency) {
      const supported = await this.currencyModel.exists({
        _id: set.preferredCurrency,
      });
      if (!supported) {
        throw new BadRequestException(
          `preferredCurrency ${set.preferredCurrency} is not a supported currency`,
        );
      }
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: set, $unset: unset },
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Account not found.');
    }
    return updated;
  }
}

function isDuplicateEmailError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const mongoError = error as { code?: number; keyPattern?: object };
  return (
    mongoError.code === MONGO_DUPLICATE_KEY_ERROR &&
    // Older servers may omit keyPattern; a duplicate on users is the email.
    (mongoError.keyPattern === undefined || 'email' in mongoError.keyPattern)
  );
}
