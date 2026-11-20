import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { BookingStatus } from '../../common/booking-status';
import { PageQueryDto } from '../../common/pagination';
import { isCalendarDate } from '../../common/validation/calendar-date';
import {
  isIanaTimeZone,
  LOCAL_TIME_PATTERN,
} from '../../common/validation/local-time';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'isCalendarDate' })
export class IsCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isCalendarDate(value);
  }
  defaultMessage() {
    return '$property must be a real date in YYYY-MM-DD format';
  }
}

@ValidatorConstraint({ name: 'isIanaTimeZone' })
class IsIanaTimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isIanaTimeZone(value);
  }
  defaultMessage() {
    return 'timeZone must be an IANA time zone such as Africa/Cairo';
  }
}

/** HTL-01: the hotel profile. Admins create it; its moderator edits it. */
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil, Garden City' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address: string;

  @ApiProperty({
    example: 'cairo',
    description: 'A city id from the seeded reference data (GEN-12).',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  cityId: string;

  @ApiProperty({
    example: 'EG',
    description: "Must be the city's country.",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be two letters' })
  countryCode: string;

  @ApiProperty({
    example: 'Africa/Cairo',
    description: 'The hotel’s IANA time zone; dates and times are local to it.',
  })
  @Transform(trim)
  @Validate(IsIanaTimeZoneConstraint)
  timeZone: string;

  @ApiProperty({ example: 'Riverside rooms ten minutes from Tahrir Square.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  description: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  starClass: number;

  @ApiPropertyOptional({ type: [String], example: ['Wi-Fi', 'Pool'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  amenities?: string[];
}

export class UpdateHotelDto extends PartialType(CreateHotelDto) {}

export class HotelCancellationTierDto {
  @ApiProperty({ example: 7, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(3650)
  daysBeforeCheckIn: number;

  @ApiProperty({ example: 50, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercentage: number;
}

/** HTL-09, HTL-10: check-in and check-out times and refund tiers. */
export class HotelPoliciesDto {
  @ApiProperty({ example: '14:00', description: 'Local hotel time, HH:mm.' })
  @Matches(LOCAL_TIME_PATTERN, { message: 'checkInTime must be HH:mm' })
  checkInTime: string;

  @ApiProperty({ example: '12:00', description: 'Local hotel time, HH:mm.' })
  @Matches(LOCAL_TIME_PATTERN, { message: 'checkOutTime must be HH:mm' })
  checkOutTime: string;

  @ApiProperty({
    type: [HotelCancellationTierDto],
    description:
      'Each threshold once. The tier with the highest threshold not above ' +
      'the whole days left before check-in decides the refund; none means 0%.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HotelCancellationTierDto)
  cancellationTiers: HotelCancellationTierDto[];
}

/** HTL-03: one individually bookable room. */
export class CreateRoomDto {
  @ApiProperty({
    example: '204',
    description: 'Room number or name, unique within the hotel.',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  label: string;

  @ApiProperty({ example: 'Double' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  roomType: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  bedCount: number;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(30)
  maxOccupancy: number;

  @ApiProperty({
    example: 250000,
    minimum: 1,
    description: 'Price per night in EGP minor units (piastres).',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  nightlyPriceMinorUnits: number;
}

/**
 * HTL-05, HTL-06: change beds, occupancy, price or type, or deactivate the
 * room. Price changes never affect existing reservations.
 */
export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @ApiPropertyOptional({
    description:
      'false hides the room from search. Refused while it has a confirmed ' +
      'or held reservation that has not ended.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DateRangeDto {
  @ApiProperty({ example: '2027-01-01', description: 'First night.' })
  @Validate(IsCalendarDateConstraint)
  fromDate: string;

  @ApiProperty({
    example: '2027-04-01',
    description: 'The day after the last night (not included).',
  })
  @Validate(IsCalendarDateConstraint)
  untilDate: string;
}

/**
 * HTL-05, HTL-06: replace the room's bookable and/or blocked ranges. Send
 * only the list to change. Ranges in one list must not overlap.
 */
export class UpdateAvailabilityDto {
  @ApiPropertyOptional({ type: [DateRangeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  bookableRanges?: DateRangeDto[];

  @ApiPropertyOptional({ type: [DateRangeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  blockedRanges?: DateRangeDto[];
}

/** HTL-15, HTL-02: a stay in the hotel's local calendar. */
export class StayQueryDto {
  @ApiProperty({ example: '2027-02-10' })
  @Validate(IsCalendarDateConstraint)
  checkInDate: string;

  @ApiProperty({ example: '2027-02-13' })
  @Validate(IsCalendarDateConstraint)
  checkOutDate: string;
}

export class OptionalStayQueryDto {
  @ApiPropertyOptional({
    description: 'With checkOutDate, also lists the rooms free for the stay.',
  })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  checkInDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  checkOutDate?: string;
}

/** HTL-08: the per-day room calendar, up to 62 days. */
export class CalendarQueryDto {
  @ApiProperty({ example: '2027-02-01' })
  @Validate(IsCalendarDateConstraint)
  fromDate: string;

  @ApiProperty({
    example: '2027-03-01',
    description: 'Not included. At most 62 days after fromDate.',
  })
  @Validate(IsCalendarDateConstraint)
  untilDate: string;
}

/** HTL-22: the hotel's reservations, 10 per page. */
export class HotelReservationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
