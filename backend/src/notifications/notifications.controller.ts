import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { UserDocument } from '../users/schemas/user.schema';
import {
  MarkAllReadDto,
  NotificationDto,
  NotificationListDto,
  NotificationQueryDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Log in first.' })
@ApiForbiddenResponse({
  description: 'Suspended account or password change required.',
})
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get()
  @ApiOperation({
    summary: 'My notifications (GEN-01)',
    description:
      'Newest first, ten per page. Reading the list does not mark notifications as read. Includes the total unread count; only the current recipient can access their notifications.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  @ApiBadRequestResponse()
  list(
    @CurrentUser() user: UserDocument,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notifications.list(user._id, query);
  }
  @Get('unread-count')
  @ApiOperation({ summary: 'My unread notification count (GEN-01)' })
  @ApiOkResponse({ type: UnreadCountDto })
  unread(@CurrentUser() user: UserDocument) {
    return this.notifications.unreadCount(user._id);
  }
  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark all my notifications as read (GEN-01)',
    description:
      'No request body. Only currently unread notifications belonging to the signed-in user change.',
  })
  @ApiOkResponse({ type: MarkAllReadDto })
  all(@CurrentUser() user: UserDocument) {
    return this.notifications.markAllRead(user._id);
  }
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark my notification as read (GEN-01)',
    description:
      'No request body. Repeating the request preserves the original read timestamp. Other recipients receive 404.',
  })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse()
  read(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.notifications.markRead(user._id, id);
  }
}
