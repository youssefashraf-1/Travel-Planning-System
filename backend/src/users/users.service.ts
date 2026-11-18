import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    return this.userModel.findById(id).exec();
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
