import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PageInfoDto } from '../../common/pagination';
import { AdminDateRangeDto } from './admin-operations.dto';

export enum AnalyticsProviderType {
  AIRLINE = 'airline',
  HOTEL = 'hotel',
}

/** BON-01 (optional): the period and provider type to report on. */
export class AnalyticsQueryDto extends AdminDateRangeDto {
  @ApiPropertyOptional({
    enum: AnalyticsProviderType,
    description: 'Airlines or hotels only; both by default.',
  })
  @IsOptional()
  @IsEnum(AnalyticsProviderType)
  providerType?: AnalyticsProviderType;
}

export class AnalyticsFiguresDto {
  @ApiProperty({ example: 12, description: 'Bookings paid in the period.' })
  bookings: number;
  @ApiProperty({ example: 2, description: 'Of those, later cancelled.' })
  cancelledBookings: number;
  @ApiProperty({ example: 4_200_000 }) grossRevenueMinorUnits: number;
  @ApiProperty({
    example: 300_000,
    description: 'Refunds issued or pending for those bookings.',
  })
  refundsMinorUnits: number;
  @ApiProperty({ example: 3_900_000 }) netRevenueMinorUnits: number;
}

export class ProviderAnalyticsDto extends AnalyticsFiguresDto {
  @ApiProperty({ enum: AnalyticsProviderType })
  providerType: AnalyticsProviderType;
  @ApiProperty() providerId: string;
  @ApiProperty({ example: 'Nile Air' }) name: string;
}

export class AnalyticsDto extends PageInfoDto {
  @ApiProperty({ example: '2026-10-21' }) fromDate: string;
  @ApiProperty({ example: '2026-11-20' }) toDate: string;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({ type: AnalyticsFiguresDto }) totals: AnalyticsFiguresDto;
  @ApiProperty({
    type: [ProviderAnalyticsDto],
    description: 'Highest net revenue first, 10 per page.',
  })
  items: ProviderAnalyticsDto[];
}
