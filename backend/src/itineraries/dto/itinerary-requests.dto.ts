import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { LOCAL_TIME_PATTERN } from '../../common/validation/local-time';
import { IsCalendarDateConstraint } from '../../hotels/dto/hotel-requests.dto';
import { BudgetCategory } from '../schemas/budget-entry.schema';
import { ItineraryVisibility } from '../schemas/itinerary.schema';

export const MAX_DAYS = 60;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
/** Trims text; "" means "remove this value". */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/** ITN-01: a new itinerary, private by default. */
export class CreateItineraryDto {
  @ApiProperty({ example: 'Ten days in Egypt', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @ApiProperty({
    type: [String],
    example: ['EG'],
    description: 'One or more country codes from the seeded list.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
      : value,
  )
  @Matches(/^[A-Z]{2}$/, {
    each: true,
    message: 'each country code must be two letters',
  })
  countryCodes: string[];

  @ApiProperty({ example: '2027-03-01', description: 'Day 1’s date.' })
  @Validate(IsCalendarDateConstraint)
  startDate: string;
}

/** ITN-01, ITN-20: edit details or make the itinerary public or private. */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  @ApiPropertyOptional({ enum: ItineraryVisibility })
  @IsOptional()
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;
}

/** ITN-05: a day needs a city from the seeded list. */
export class CreateDayDto {
  @ApiProperty({ example: 'cairo' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  cityId: string;

  @ApiPropertyOptional({ example: 'Pyramids in the morning.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateDayDto extends PartialType(CreateDayDto) {}

/** ITN-08: move one day to a new 1-based position. */
export class ReorderDaysDto {
  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({ example: 1, minimum: 1, description: 'The new day number.' })
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  position: number;
}

export class MoneyDto {
  @ApiProperty({
    example: 50000,
    minimum: 0,
    description: 'In the currency’s minor unit: piastres for EGP, yen for JPY.',
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinorUnits: number;

  @ApiProperty({ example: 'EGP', description: 'A supported currency.' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be three letters' })
  currency: string;
}

/** ITN-10: an activity for one day. */
export class CreateActivityDto {
  @ApiProperty({ example: 'Egyptian Museum' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'See the Tutankhamun collection.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({
    example: '10:30',
    description: 'Local HH:mm. Send null to remove it.',
  })
  @IsOptional()
  @Matches(LOCAL_TIME_PATTERN, { message: 'localTime must be HH:mm' })
  localTime?: string | null;

  @ApiPropertyOptional({
    type: MoneyDto,
    description: 'Counted under Activities. Send null to remove it.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  cost?: MoneyDto | null;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto) {}

/** ITN-14: a non-negative budget entry for one day. */
export class CreateBudgetDto extends MoneyDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiPropertyOptional({ example: 'Dinner on the Nile' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto) {}

/** ITN-16: intercity transport between two cities, on one day. */
export class CreateTransportCostDto extends MoneyDto {
  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({ example: 'Train' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  mode: string;

  @ApiProperty({ example: 'cairo' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  fromCityId: string;

  @ApiProperty({ example: 'paris' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  toCityId: string;
}

export class UpdateTransportCostDto extends PartialType(
  CreateTransportCostDto,
) {}

/** ITN-18: the display currency for budgets. */
export class CurrencyQueryDto {
  @ApiPropertyOptional({
    description:
      'Defaults to your preferred currency (ACC-09), or EGP when none is set.',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be three letters' })
  currency?: string;
}

/** ITN-21: public search. */
export class PublicSearchQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Matches the title, a country or a city (name or code).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ description: 'Two-letter country code.' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be two letters' })
  countryCode?: string;

  @ApiPropertyOptional({ description: 'A seeded city id.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  cityId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  minDays?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  maxDays?: number;
}

/** ITN-25: hotels for one city group's dates. */
export class ItineraryHotelsQueryDto extends PageQueryDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'The city group number, as in the itinerary details.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  group: number;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  guests: number;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rooms: number = 1;
}

/** ITN-26: flights from an origin to the first day's city. */
export class ItineraryFlightsQueryDto {
  @ApiProperty({ description: 'The origin airport id.' })
  @IsMongoId()
  originAirportId: string;

  @ApiPropertyOptional({
    enum: ['one_way', 'round_trip'],
    default: 'one_way',
  })
  @IsOptional()
  @IsEnum(['one_way', 'round_trip'])
  tripType: 'one_way' | 'round_trip' = 'one_way';

  @ApiPropertyOptional({
    description: 'Defaults to the itinerary start date.',
  })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  departureDate?: string;

  @ApiPropertyOptional({
    description: 'Round trips: defaults to the last day’s date.',
  })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  returnDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  adults: number = 1;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8)
  children: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9)
  infants: number = 0;
}
