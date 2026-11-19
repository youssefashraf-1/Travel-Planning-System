import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { SESSION_INACTIVITY_MINUTES } from './auth.constants';
import { Session, SessionDocument } from './schemas/session.schema';

/** A refresh token as handed to the browser, with its session. */
export interface IssuedSession {
  session: SessionDocument;
  refreshToken: string;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function inactivityExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_INACTIVITY_MINUTES * 60_000);
}

/** Only sessions that are neither revoked nor expired can be used. */
function usable(now: Date) {
  return { revokedAt: { $exists: false }, expiresAt: { $gt: now } };
}

/**
 * Server-side sessions (ACC-06, ACC-19). Every check and renewal is a single
 * atomic database update, so an expired or revoked session can never be
 * extended, even by simultaneous requests.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  /** Starts a session at login. */
  async create(userId: Types.ObjectId, now: Date): Promise<IssuedSession> {
    const refreshToken = newRefreshToken();
    const session = await this.sessionModel.create({
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      lastActivityAt: now,
      expiresAt: inactivityExpiry(now),
    });
    return { session, refreshToken };
  }

  /**
   * Records an authenticated request: if the session is still usable, its
   * 30-minute window restarts from now. Returns false when it has expired,
   * was revoked, or belongs to someone else.
   */
  async touch(sessionId: string, userId: string, now: Date): Promise<boolean> {
    if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) {
      return false;
    }
    const result = await this.sessionModel
      .updateOne(
        { _id: sessionId, userId, ...usable(now) },
        { $set: { lastActivityAt: now, expiresAt: inactivityExpiry(now) } },
      )
      .exec();
    return result.matchedCount === 1;
  }

  /**
   * Exchanges a refresh token for a new one (rotation) and renews the
   * session. Each refresh token works once. Returns null when the token is
   * unknown, already used, or its session is expired or revoked.
   */
  async rotate(refreshToken: string, now: Date): Promise<IssuedSession | null> {
    const nextToken = newRefreshToken();
    const session = await this.sessionModel
      .findOneAndUpdate(
        { refreshTokenHash: hashRefreshToken(refreshToken), ...usable(now) },
        {
          $set: {
            refreshTokenHash: hashRefreshToken(nextToken),
            lastActivityAt: now,
            expiresAt: inactivityExpiry(now),
          },
        },
        { new: true },
      )
      .exec();
    return session ? { session, refreshToken: nextToken } : null;
  }

  /** Ends the session that owns this refresh token (logout). */
  async revokeByRefreshToken(refreshToken: string, now: Date): Promise<void> {
    await this.sessionModel
      .updateOne(
        {
          refreshTokenHash: hashRefreshToken(refreshToken),
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /** Ends a session by id (logout when only the access token is present). */
  async revokeById(sessionId: string, now: Date): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return;
    }
    await this.sessionModel
      .updateOne(
        { _id: sessionId, revokedAt: { $exists: false } },
        { $set: { revokedAt: now } },
      )
      .exec();
  }

  /**
   * Ends every open session of a user, optionally keeping one (the browser
   * that changed the password). Used after password changes, admin resets,
   * suspension and deactivation.
   */
  async revokeAllForUser(
    userId: Types.ObjectId,
    now: Date,
    exceptSessionId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      userId,
      revokedAt: { $exists: false },
    };
    if (exceptSessionId && Types.ObjectId.isValid(exceptSessionId)) {
      filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
    }
    await this.sessionModel
      .updateMany(filter, { $set: { revokedAt: now } })
      .exec();
  }
}
