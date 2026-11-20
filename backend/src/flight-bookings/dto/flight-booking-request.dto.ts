import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
