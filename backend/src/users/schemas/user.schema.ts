import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Airline } from '../../airlines/schemas/airline.schema';
import { Hotel } from '../../hotels/schemas/hotel.schema';
import { Currency } from '../../reference-data/schemas/currency.schema';

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

  @Prop({
    type: String,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    ref: Currency.name,
  })
  preferredCurrency?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: function (this: User) {
      if (this.role === UserRole.AIRLINE_MODERATOR) {
        return Airline.name;
      }
      if (this.role === UserRole.HOTEL_MODERATOR) {
        return Hotel.name;
      }
      return undefined;
    },
  })
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

  /**
   * ACC-02: self-registered travelers start unverified and cannot book
   * until they follow the emailed link. Seeded admins and moderators made
   * by an admin count as verified.
   */
  @Prop({ type: Boolean, required: true, default: true })
  emailVerified: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ role: 1, status: 1, createdAt: -1 });
UserSchema.index({ status: 1, createdAt: -1 });
UserSchema.index({ assignedProviderId: 1, role: 1 });

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
