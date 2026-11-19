import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export type SessionDocument = HydratedDocument<Session>;

/**
 * One signed-in browser (ACC-06, ACC-19). The session ends after 30 minutes
 * without an authenticated request, or when it is revoked at logout.
 * Only a SHA-256 digest of the refresh token is stored, never the token.
 */
@Schema({ timestamps: true })
export class Session {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  refreshTokenHash: string;

  @Prop({ type: Date, required: true })
  lastActivityAt: Date;

  /** Inactivity expiry: 30 minutes after the latest authenticated request. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ userId: 1, revokedAt: 1 });
// MongoDB removes a session one day after it expired, keeping the
// collection small while recent sessions stay available for checks.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
