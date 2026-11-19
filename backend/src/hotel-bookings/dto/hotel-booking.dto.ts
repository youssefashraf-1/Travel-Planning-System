import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidateNested,
} from 'class-validator';
import { BookingStatus } from '../../common/booking-status';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { IsCalendarDateConstraint } from '../../hotels/dto/hotel-requests.dto';

export const MAX_ROOMS_PER_BOOKING = 10;

/** HTL-16: who stays in one room. */
export class BookedRoomRequestDto {
  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  roomId: string;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(30)
  adults: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [7],
    description: 'Age of each child, 0–17.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  childAges?: number[];
}

/**
 * HTL-16, HTL-18: one or more rooms of one hotel for the same dates, held
 * together for 10 minutes while the traveler pays.
 */
export class CreateHotelBookingDto {
  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  hotelId: string;

  @ApiProperty({ example: '2027-02-10', description: 'Hotel local date.' })
  @Validate(IsCalendarDateConstraint)
  checkInDate: string;

  @ApiProperty({ example: '2027-02-13' })
  @Validate(IsCalendarDateConstraint)
  checkOutDate: string;

  @ApiProperty({
    type: [BookedRoomRequestDto],
    description: `1–${MAX_ROOMS_PER_BOOKING} different rooms. At least one adult in the reservation.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => BookedRoomRequestDto)
  rooms: BookedRoomRequestDto[];
}

/** HTL-21, GEN-03: cancelling needs explicit confirmation. */
export class CancelHotelBookingDto {
  @ApiProperty({
    example: true,
    description: 'Must be true. Check the refund in the details first.',
  })
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true to cancel the reservation' })
  confirm: boolean;
}

export enum ReservationGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

/** HTL-20: my reservations in one group, 10 per page. */
export class ListHotelBookingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: ReservationGroup,
    default: ReservationGroup.UPCOMING,
    description:
      'upcoming: held or confirmed. past: completed (check-out passed). ' +
      'cancelled: cancelled or expired holds.',
  })
  @IsOptional()
  @IsEnum(ReservationGroup)
  group: ReservationGroup = ReservationGroup.UPCOMING;
}

export class BookedHotelDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Nile View Hotel' }) name: string;
  @ApiProperty() address: string;
  @ApiProperty({ example: 'Cairo' }) cityName: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone: string;
}

export class ReservedRoomDto {
  @ApiProperty() roomId: string;
  @ApiProperty({ example: '204' }) label: string;
  @ApiProperty({ example: 2 }) adults: number;
  @ApiProperty({ type: [Number], example: [7] }) childAges: number[];
  @ApiProperty({ example: 3 }) maxOccupancy: number;
  @ApiProperty({ example: 250000, description: 'Price per night when booked.' })
  nightlyPriceMinorUnits: number;
  @ApiProperty({ example: 750000 }) stayPriceMinorUnits: number;
}

export class HotelCancellationQuoteDto {
  @ApiProperty({ description: 'False from the check-in date on.' })
  allowed: boolean;
  @ApiProperty({ example: 50 }) refundPercentage: number;
  @ApiProperty({ example: 375000 }) refundMinorUnits: number;
}

export class HotelBookingDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({
    example: 'K7Q2MX',
    description: 'Set on confirmation.',
  })
  reference?: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({ type: BookedHotelDto }) hotel: BookedHotelDto;
  @ApiProperty({ example: '2027-02-10' }) checkInDate: string;
  @ApiProperty({ example: '2027-02-13' }) checkOutDate: string;
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ example: '14:00', description: 'HTL-09, hotel local time.' })
  checkInTime: string;
  @ApiProperty({ example: '12:00' }) checkOutTime: string;
  @ApiProperty({ type: [ReservedRoomDto] }) rooms: ReservedRoomDto[];
  @ApiProperty({ example: 3 }) guests: number;
  @ApiProperty({ example: 750000 }) totalMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ daysBeforeCheckIn: 7, refundPercentage: 50 }],
    description: 'The tiers agreed at booking time (HTL-10).',
  })
  cancellationTiers: { daysBeforeCheckIn: number; refundPercentage: number }[];
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Rooms are held until this time while payment is pending.',
  })
  holdExpiresAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  policyAcceptedAt?: Date;
  @ApiPropertyOptional({
    type: HotelCancellationQuoteDto,
    description: 'HTL-21: present for confirmed reservations.',
  })
  cancellation?: HotelCancellationQuoteDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class HotelBookingListDto extends PageInfoDto {
  @ApiProperty({ enum: ReservationGroup }) group: ReservationGroup;
  @ApiProperty({ type: [HotelBookingDto] }) items: HotelBookingDto[];
}

export class CancelledHotelBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: [BookingStatus.CANCELLED] }) status: BookingStatus;
  @ApiProperty({ example: 50 }) refundPercentage: number;
  @ApiProperty({ example: 375000 }) refundMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    enum: ['pending', 'none'],
    description:
      'pending: recorded and sent through Stripe by the payment service. ' +
      'none: no refund is due.',
  })
  refundStatus: 'pending' | 'none';
}
