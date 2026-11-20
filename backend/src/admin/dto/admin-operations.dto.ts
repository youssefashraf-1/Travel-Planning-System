import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsIn,
  IsMongoId,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
} from 'class-validator';
import { AuditAction } from '../../audit-logs/schemas/audit-log.schema';
import { ProviderType } from '../../auth/access';
import { BookingStatus } from '../../common/booking-status';
import { PAGE_SIZE, PageInfoDto, PageQueryDto } from '../../common/pagination';
import { IsCalendarDateConstraint } from '../../hotels/dto/hotel-requests.dto';

export enum AdminBookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

export class AdminDateRangeDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Inclusive YYYY-MM-DD start date.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Validate(IsCalendarDateConstraint)
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Inclusive YYYY-MM-DD end date.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Validate(IsCalendarDateConstraint)
  toDate?: string;
}

export function checkAdminPageAndDates(
  query: AdminDateRangeDto | PageQueryDto,
): void {
  if (!Number.isSafeInteger((query.page - 1) * PAGE_SIZE))
    throw new BadRequestException('Page number is too large.');
  if (
    'fromDate' in query &&
    'toDate' in query &&
    query.fromDate &&
    query.toDate &&
    query.fromDate > query.toDate
  )
    throw new BadRequestException('fromDate cannot be after toDate.');
}

export class AdminBookingsQueryDto extends AdminDateRangeDto {
  @ApiPropertyOptional({ enum: AdminBookingType })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(AdminBookingType)
  type?: AdminBookingType;

  @ApiPropertyOptional({ enum: BookingStatus })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}

export class AdminAuditQueryDto extends AdminDateRangeDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({
    enum: [
      'User',
      'Airline',
      'Hotel',
      'BlogPost',
      'Comment',
      'Review',
      'Itinerary',
      'Report',
    ],
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn([
    'User',
    'Airline',
    'Hotel',
    'BlogPost',
    'Comment',
    'Review',
    'Itinerary',
    'Report',
  ])
  targetModel?: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsMongoId()
  targetId?: string;
}

export class ProviderListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ConfirmProviderActionDto {
  @ApiProperty({ example: true }) @IsBoolean() @Equals(true) confirm: boolean;
}

export class AdminProviderDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ProviderType }) type: ProviderType;
  @ApiProperty() name: string;
  @ApiProperty() isActive: boolean;
}

export class AdminProviderListDto extends PageInfoDto {
  @ApiProperty({ type: [AdminProviderDto] }) items: AdminProviderDto[];
}

export class AdminBookingUserDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() email?: string;
}

export class AdminBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: AdminBookingType }) type: AdminBookingType;
  @ApiPropertyOptional() reference?: string;
  @ApiProperty({ type: AdminBookingUserDto }) user: AdminBookingUserDto;
  @ApiProperty({ type: [AdminProviderDto] }) providers: AdminProviderDto[];
  @ApiPropertyOptional({
    description:
      'Outbound departure airport-local date, or hotel check-in date.',
  })
  startDate?: string;
  @ApiPropertyOptional({ description: 'Hotel check-out date.' })
  endDate?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  departureAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) arrivalAt?: Date;
  @ApiProperty() amountMinorUnits: number;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class AdminBookingListDto extends PageInfoDto {
  @ApiProperty({ type: [AdminBookingDto] }) items: AdminBookingDto[];
}

export class AdminAuditDto {
  @ApiProperty() id: string;
  @ApiProperty() actorId: string;
  @ApiProperty() actorName: string;
  @ApiProperty({ enum: AuditAction }) action: AuditAction;
  @ApiProperty() targetModel: string;
  @ApiProperty() targetId: string;
  @ApiPropertyOptional() reportId?: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class AdminAuditListDto extends PageInfoDto {
  @ApiProperty({ type: [AdminAuditDto] }) items: AdminAuditDto[];
}
