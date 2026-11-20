import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';

export enum AccountTokenPurpose {
  EMAIL_VERIFICATION = 'email_verification',
  PASSWORD_RESET = 'password_reset',
}

/**
 * A one-time link token for email verification (ACC-02) or password reset
 * (ACC-07). Only a SHA-256 digest is stored, never the token itself.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AccountToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: AccountTokenPurpose, required: true })
  purpose: AccountTokenPurpose;

  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** Set when used or replaced by a newer link; the token then stops working. */
  @Prop({ type: Date })
  usedAt?: Date;
}

export const AccountTokenSchema = SchemaFactory.createForClass(AccountToken);
AccountTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1 });
// MongoDB deletes tokens a day after they expire.
AccountTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60 },
);
