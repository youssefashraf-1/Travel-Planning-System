import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
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
import { isCalendarDate } from '../../common/validation/calendar-date';
import { CabinClass } from '../../flights/schemas/cabin-inventory.schema';
import { MAX_PASSENGERS } from '../flight-booking-rules';
import { PassengerType } from '../schemas/passenger.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ValidatorConstraint({ name: 'isCalendarDate' })
class IsCalendarDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isCalendarDate(value);
  }
  defaultMessage() {
    return 'dateOfBirth must be a real date in YYYY-MM-DD format';
  }
}

/** FLT-19: one traveler's details and optional extra bags. */
export class BookingPassengerDto {
  @ApiProperty({
    enum: PassengerType,
    example: PassengerType.ADULT,
    description:
      'Adult 12+, child 2–11, infant under 2 on the outbound flight date. ' +
      'It must match the date of birth.',
  })
  @IsEnum(PassengerType)
  type: PassengerType;

  @ApiProperty({ example: 'Mona Hassan', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: '1995-04-12', description: 'YYYY-MM-DD' })
  @Validate(IsCalendarDateConstraint)
  dateOfBirth: string;

  @ApiProperty({
    example: 'A12345678',
    description: '3–30 letters, digits or dashes. Never shown in full again.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9-]{3,30}$/, {
    message: 'passportOrIdNumber must be 3-30 letters, digits or dashes',
  })
  passportOrIdNumber: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [20],
    description:
      'FLT-19: weight in kg of each extra bag on the outbound flight. ' +
      "Up to the airline's maximum count, each within the cabin's bag weight.",
  })
  @IsOptional()
  @IsArray()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
  outboundExtraBagWeightsKg?: number[];

  @ApiPropertyOptional({
    type: [Number],
    example: [],
    description: 'Extra bags on the return flight (round trips only).',
  })
  @IsOptional()
  @IsArray()
  @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
  returnExtraBagWeightsKg?: number[];
}

/**
 * The flights, cabins and passengers to price (POST /flight-bookings) or to
 * hold (POST /flight-bookings/hold). Prices always come from the server.
 */
export class FlightBookingRequestDto {
  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  outboundFlightId: string;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  outboundCabinClass: CabinClass;

  @ApiPropertyOptional({
    description:
      'FLT-12: for a round trip, a flight on the reverse route that leaves ' +
      'after the outbound flight lands.',
  })
  @IsOptional()
  @IsMongoId()
  returnFlightId?: string;

  @ApiPropertyOptional({
    enum: CabinClass,
    description: 'Defaults to the outbound cabin class.',
  })
  @IsOptional()
  @IsEnum(CabinClass)
  returnCabinClass?: CabinClass;

  @ApiProperty({
    type: [BookingPassengerDto],
    description: `1–${MAX_PASSENGERS} passengers, at least one adult and no more infants than adults.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PASSENGERS)
  @ValidateNested({ each: true })
  @Type(() => BookingPassengerDto)
  passengers: BookingPassengerDto[];
}

/** FLT-26, GEN-03: cancelling needs explicit confirmation. */
export class CancelFlightBookingDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true. Check the refund in the booking details (cancellation) first.',
  })
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true to cancel the booking' })
  confirm: boolean;
}

/** FLT-27 (optional): move one flight of a confirmed booking. */
export class ChangeFlightDto {
  @ApiProperty({ enum: ['outbound', 'return'], example: 'outbound' })
  @IsIn(['outbound', 'return'])
  leg: 'outbound' | 'return';

  @ApiProperty({
    example: '665f1c2e8b3a4d0012345678',
    description:
      'A scheduled flight on the same route, with the same cabin class.',
  })
  @IsMongoId()
  newFlightId: string;

  @ApiPropertyOptional({
    description:
      'true only shows the fare difference; nothing is changed or reserved.',
  })
  @IsOptional()
  @IsBoolean()
  previewOnly?: boolean;
}

/** FLT-28 (optional): pick a seat for one passenger on one flight. */
export class ChooseSeatDto {
  @ApiProperty({ enum: ['outbound', 'return'], example: 'outbound' })
  @IsIn(['outbound', 'return'])
  leg: 'outbound' | 'return';

  @ApiProperty({
    example: 1,
    description: 'Passenger number, in booking order, starting at 1.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PASSENGERS)
  passenger: number;

  @ApiProperty({
    example: '21C',
    description: 'A seat from GET /api/flights/{id}/seats.',
  })
  @Transform(trim)
  @IsString()
  @Matches(/^\d{1,3}[A-Ka-k]$/, { message: 'seat must look like 21C' })
  seat: string;
}

/** FLT-28: which cabin's seat map to show. */
export class SeatMapQueryDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;
}
