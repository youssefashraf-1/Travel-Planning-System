import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserRole } from './schemas/user.schema';

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

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.userModel.findById(id).exec();
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
