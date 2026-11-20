import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AccountToken,
  AccountTokenPurpose,
} from './schemas/account-token.schema';

const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** One-time tokens for emailed links (ACC-02, ACC-07). */
@Injectable()
export class AccountTokensService {
  constructor(
    @InjectModel(AccountToken.name)
    private readonly tokens: Model<AccountToken>,
  ) {}

  /**
   * Creates a new token and invalidates the user's earlier unused tokens
   * for the same purpose, so only the newest link works (ACC-07).
   */
  async issue(
    userId: Types.ObjectId,
    purpose: AccountTokenPurpose,
    validMinutes: number,
    now = new Date(),
  ): Promise<string> {
    await this.tokens
      .updateMany(
        { userId, purpose, usedAt: { $exists: false } },
        { $set: { usedAt: now } },
      )
      .exec();
    const token = randomBytes(32).toString('base64url');
    await this.tokens.create({
      userId,
      purpose,
      tokenHash: digest(token),
      expiresAt: new Date(now.getTime() + validMinutes * 60_000),
    });
    return token;
  }

  /**
   * Uses a token once. The check and the update are one atomic write, so
   * two requests with the same link cannot both succeed. Returns the user
   * id, or null for an unknown, expired, used or replaced token.
   */
  async consume(
    token: string,
    purpose: AccountTokenPurpose,
    now = new Date(),
  ): Promise<Types.ObjectId | null> {
    if (!token || token.length > 200) return null;
    const record = await this.tokens
      .findOneAndUpdate(
        {
          tokenHash: digest(token),
          purpose,
          usedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
      )
      .lean()
      .exec();
    return record?.userId ?? null;
  }
}
