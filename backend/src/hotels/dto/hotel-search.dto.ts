import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
} from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { IsCalendarDateConstraint } from './hotel-requests.dto';

export enum HotelSort {
  PRICE = 'price',
  RATING = 'rating',
}

export enum HotelSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** HTL-11, HTL-12: where, when, for how many, and how to filter and sort. */
export class SearchHotelsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'A seeded city id. Send cityId or countryCode.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ description: 'Two letters, for example EG.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be two letters' })
  countryCode?: string;

  @ApiProperty({ example: '2027-02-10', description: 'Hotel local date.' })
  @Validate(IsCalendarDateConstraint)
  checkInDate: string;

  @ApiProperty({ example: '2027-02-13' })
  @Validate(IsCalendarDateConstraint)
  checkOutDate: string;

  @ApiProperty({ example: 2, minimum: 1, description: 'Adults and children.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  guests: number;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rooms: number = 1;

  @ApiPropertyOptional({
    description:
      'Inclusive, per night, in EGP minor units: the price of the ' +
      "hotel's cheapest free room.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceMinorUnits?: number;

  @ApiPropertyOptional({ description: 'Inclusive, like minPriceMinorUnits.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinorUnits?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Minimum average rating; unrated hotels are then excluded.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: HotelSort, default: HotelSort.PRICE })
  @IsOptional()
  @IsEnum(HotelSort)
  sortBy: HotelSort = HotelSort.PRICE;

  @ApiPropertyOptional({
    enum: HotelSortOrder,
    description: 'Default: asc for price, desc for rating.',
  })
  @IsOptional()
  @IsEnum(HotelSortOrder)
  sortOrder?: HotelSortOrder;
}

export class HotelSearchItemDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Nile View Hotel' }) name: string;
  @ApiProperty() address: string;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty({ example: 'Cairo' }) cityName: string;
  @ApiProperty({ example: 'EG' }) countryCode: string;
  @ApiProperty({ example: 4 }) starClass: number;
  @ApiProperty({ type: [String] }) amenities: string[];
  @ApiPropertyOptional({ description: 'The first photo.' }) photoUrl?: string;
  @ApiProperty({
    example: 250000,
    description: 'Cheapest free room, per night.',
  })
  cheapestNightlyPriceMinorUnits: number;
  @ApiProperty({
    example: 750000,
    description: 'That room for the whole stay.',
  })
  cheapestStayPriceMinorUnits: number;
  @ApiProperty({ example: 4, description: 'Rooms free for the whole stay.' })
  freeRoomCount: number;
  @ApiPropertyOptional({ example: 4.3 }) averageRating?: number;
  @ApiProperty({ example: 12 }) ratingCount: number;
}

export class HotelSearchResultDto extends PageInfoDto {
  @ApiProperty({ example: '2027-02-10' }) checkInDate: string;
  @ApiProperty({ example: '2027-02-13' }) checkOutDate: string;
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({ type: [HotelSearchItemDto] }) items: HotelSearchItemDto[];
}
