import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { NotificationType } from '../schemas/notification.schema';

export class NotificationQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: unread only; false: read only; omit: all.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unread?: boolean;
}
export class NotificationDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: NotificationType }) type: NotificationType;
  @ApiProperty() subjectModel: string;
  @ApiProperty() subjectId: string;
  @ApiProperty() title: string;
  @ApiProperty() message: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}
export class UnreadCountDto {
  @ApiProperty() unreadCount: number;
}
export class NotificationListDto extends PageInfoDto {
  @ApiProperty({ type: [NotificationDto] }) items: NotificationDto[];
  @ApiProperty({
    description:
      'All unread notifications for this user, independent of the list filter.',
  })
  unreadCount: number;
}
export class MarkAllReadDto {
  @ApiProperty() markedCount: number;
}
