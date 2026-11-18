import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  TRAVELER = 'traveler',
  ADMIN = 'admin',
  AIRLINE_MODERATOR = 'airline_moderator',
  HOTEL_MODERATOR = 'hotel_moderator',
}

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({
    type: String,
    enum: UserRole,
    required: true,
    default: UserRole.TRAVELER,
  })
  role: UserRole;

  @Prop({
    type: String,
    enum: UserStatus,
    required: true,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: String, trim: true, uppercase: true, match: /^[A-Z]{3}$/ })
  preferredCurrency?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  assignedProviderId?: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    validate: Number.isInteger,
  })
  failedLoginAttempts: number;

  @Prop({ type: Date })
  lockedUntil?: Date;

  @Prop({ type: Boolean, required: true, default: false })
  mustChangePassword: boolean;

  @Prop({ type: Date })
  termsAndPrivacyAcceptedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('validate', function () {
  const isModerator =
    this.role === UserRole.AIRLINE_MODERATOR ||
    this.role === UserRole.HOTEL_MODERATOR;

  if (isModerator && this.assignedProviderId == null) {
    this.invalidate('assignedProviderId', 'A moderator needs a provider.');
  }

  if (!isModerator && this.assignedProviderId != null) {
    this.invalidate(
      'assignedProviderId',
      'Only moderators can have a provider.',
    );
  }
});
