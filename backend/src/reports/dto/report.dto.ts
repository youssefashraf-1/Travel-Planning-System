import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { ReportStatus } from '../schemas/report.schema';

export enum ContentType {
  POST = 'post',
  COMMENT = 'comment',
  REVIEW = 'review',
  ITINERARY = 'itinerary',
}
export enum ReportResolution {
  DISMISS = 'dismiss',
  HIDE = 'hide',
  DELETE = 'delete',
}

export class CreateReportDto {
  @ApiProperty({ enum: ContentType })
  @IsEnum(ContentType)
  targetType: ContentType;
  @ApiProperty() @IsMongoId() targetId: string;
  @ApiProperty({
    example: 'This content contains harassment.',
    maxLength: 1000,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class ResolveReportDto {
  @ApiProperty({ enum: ReportResolution })
  @IsEnum(ReportResolution)
  action: ReportResolution;
  @ApiProperty({ example: true }) @IsBoolean() @Equals(true) confirm: boolean;
}

export class ReportsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus, default: ReportStatus.OPEN })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class ReportDto {
  @ApiProperty() id: string;
  @ApiProperty() reporterId: string;
  @ApiProperty({ enum: ContentType }) targetType: ContentType;
  @ApiProperty() targetId: string;
  @ApiProperty() reason: string;
  @ApiProperty({ enum: ReportStatus }) status: ReportStatus;
  @ApiPropertyOptional() resolvedById?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) resolvedAt?: Date;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class ReportListDto extends PageInfoDto {
  @ApiProperty({ type: [ReportDto] }) items: ReportDto[];
}

export class ModeratedContentDto {
  @ApiProperty({ enum: ContentType }) type: ContentType;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Stored content, including hidden content. Restricted to its author or an administrator.',
  })
  content: Record<string, unknown>;
}
