import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Airline } from '../../airlines/schemas/airline.schema';
import { Hotel } from '../../hotels/schemas/hotel.schema';
import {
  Report,
  reportableContentModels,
} from '../../reports/schemas/report.schema';
import { User } from '../../users/schemas/user.schema';

export enum AuditAction {
  ACCOUNT_SUSPENDED = 'account_suspended',
  ACCOUNT_REACTIVATED = 'account_reactivated',
  ACCOUNT_PASSWORD_RESET = 'account_password_reset',
  PROVIDER_DEACTIVATED = 'provider_deactivated',
  PROVIDER_REACTIVATED = 'provider_reactivated',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_DELETED = 'content_deleted',
  REPORT_DISMISSED = 'report_dismissed',
}

const targetModels: Record<AuditAction, readonly string[]> = {
  [AuditAction.ACCOUNT_SUSPENDED]: [User.name],
  [AuditAction.ACCOUNT_REACTIVATED]: [User.name],
  [AuditAction.ACCOUNT_PASSWORD_RESET]: [User.name],
  [AuditAction.PROVIDER_DEACTIVATED]: [Airline.name, Hotel.name],
  [AuditAction.PROVIDER_REACTIVATED]: [Airline.name, Hotel.name],
  [AuditAction.CONTENT_HIDDEN]: reportableContentModels,
  [AuditAction.CONTENT_DELETED]: reportableContentModels,
  [AuditAction.REPORT_DISMISSED]: [Report.name],
};

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    required: true,
    immutable: true,
  })
  actorId: Types.ObjectId;

  @Prop({ type: String, enum: AuditAction, required: true, immutable: true })
  action: AuditAction;

  @Prop({
    required: true,
    immutable: true,
    validate: {
      validator: function (this: AuditLog, value: string) {
        return targetModels[this.action]?.includes(value) ?? false;
      },
      message: 'The audit target must match the recorded action.',
    },
  })
  targetModel: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    refPath: 'targetModel',
    required: true,
    immutable: true,
  })
  targetId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Report.name,
    immutable: true,
  })
  reportId?: Types.ObjectId;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ targetModel: 1, targetId: 1, createdAt: -1 });
