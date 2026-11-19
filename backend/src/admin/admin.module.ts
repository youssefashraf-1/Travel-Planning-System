import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditLog,
  AuditLogSchema,
} from '../audit-logs/schemas/audit-log.schema';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

/** Administrator features. Account management lives here (ACC-07a, ACC-15, ACC-16). */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService, RolesGuard],
})
export class AdminModule {}
