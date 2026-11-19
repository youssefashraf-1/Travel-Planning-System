import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { BookingStatus } from '../../common/booking-status';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { CabinClass } from '../../flights/schemas/cabin-inventory.schema';
import { PassengerType } from '../schemas/passenger.schema';

export class BookedAirportDto {
  @ApiProperty({ example: 'CAI' }) iataCode: string;
  @ApiProperty({ example: 'Cairo International Airport' }) name: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone: string;
}

export class BookedSegmentDto {
  @ApiProperty({ enum: ['outbound', 'return'] }) leg: 'outbound' | 'return';
  @ApiProperty() flightId: string;
  @ApiProperty({ example: 'MS777' }) flightNumber: string;
  @ApiProperty({ example: 'EgyptAir' }) airlineName: string;
  @ApiProperty({ type: BookedAirportDto }) departureAirport: BookedAirportDto;
  @ApiProperty({ type: BookedAirportDto }) arrivalAirport: BookedAirportDto;
  @ApiProperty({
    example: '2027-03-01T09:30',
    description: 'Departure airport local time (GEN-06).',
  })
  departureLocalDateTime: string;
  @ApiProperty({
    example: '2027-03-01T14:10',
    description: 'Arrival airport local time.',
  })
  arrivalLocalDateTime: string;
  @ApiProperty({ type: String, format: 'date-time' }) departureAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) arrivalAt: Date;
  @ApiProperty({ example: 340 }) durationMinutes: number;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty({ example: 450000 }) cabinFareMinorUnits: number;
  @ApiProperty({ example: 1 }) freeBagCount: number;
  @ApiProperty({ example: 23 }) maxBagWeightKg: number;
  @ApiPropertyOptional({ example: 50000 }) pricePerExtraBagMinorUnits?: number;
  @ApiProperty({ example: 2 }) maxExtraBagsPerPassenger: number;
  @ApiProperty({
    example: 3,
    description: 'Seats this booking takes on the flight.',
  })
  seats: number;
}

export class PassengerSegmentPriceDto {
  @ApiProperty({ enum: ['outbound', 'return'] }) leg: 'outbound' | 'return';
  @ApiProperty({ enum: PassengerType }) type: PassengerType;
  @ApiProperty({ example: 450000 }) fareMinorUnits: number;
  @ApiProperty({ type: [Number], example: [20] }) extraBagWeightsKg: number[];
  @ApiProperty({ example: 50000 }) baggageFeeMinorUnits: number;
}

export class BookedPassengerDto {
  @ApiProperty({ example: 'Mona Hassan' }) fullName: string;
  @ApiProperty({ example: '1995-04-12' }) dateOfBirth: string;
  @ApiProperty({
    example: '•••••5678',
    description: 'Only the last four characters are ever shown.',
  })
  passportOrIdNumber: string;
  @ApiProperty({ type: [PassengerSegmentPriceDto] })
  segments: PassengerSegmentPriceDto[];
}

/** FLT-21: everything the traveler pays for, before payment. */
export class FlightBookingSummaryDto {
  @ApiProperty({ enum: ['one_way', 'round_trip'] })
  tripType: 'one_way' | 'round_trip';
  @ApiProperty({ type: [BookedSegmentDto] }) segments: BookedSegmentDto[];
  @ApiProperty({ type: [BookedPassengerDto] }) passengers: BookedPassengerDto[];
  @ApiProperty({ example: 900000 }) faresMinorUnits: number;
  @ApiProperty({ example: 50000 }) baggageFeesMinorUnits: number;
  @ApiProperty({ example: 950000 }) totalMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: "The outbound airline's cancellation tiers (FLT-09).",
  })
  cancellationTiers: {
    daysBeforeDeparture: number;
    refundPercentage: number;
  }[];
}

export class CancellationQuoteDto {
  @ApiProperty({ description: 'False once the outbound flight has departed.' })
  allowed: boolean;
  @ApiProperty({ example: 75 }) refundPercentage: number;
  @ApiProperty({ example: 712500 }) refundMinorUnits: number;
}

export class FlightBookingDto extends FlightBookingSummaryDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({
    example: 'K7Q2MX',
    description: 'Set on confirmation.',
  })
  reference?: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Seats are held until this time while payment is pending.',
  })
  holdExpiresAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  policyAcceptedAt?: Date;
  @ApiPropertyOptional({
    type: CancellationQuoteDto,
    description: 'FLT-26: present for confirmed bookings.',
  })
  cancellation?: CancellationQuoteDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export enum BookingGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

/** FLT-25: my bookings in one group, 10 per page. */
export class ListFlightBookingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: BookingGroup,
    default: BookingGroup.UPCOMING,
    description:
      'upcoming: held or confirmed, not yet departed. past: completed or ' +
      'departed. cancelled: cancelled or expired holds.',
  })
  @IsOptional()
  @IsEnum(BookingGroup)
  group: BookingGroup = BookingGroup.UPCOMING;
}

export class FlightBookingListItemDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ example: 'K7Q2MX' }) reference?: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({ enum: ['one_way', 'round_trip'] })
  tripType: 'one_way' | 'round_trip';
  @ApiProperty({ type: [BookedSegmentDto] }) segments: BookedSegmentDto[];
  @ApiProperty({ example: 3 }) passengerCount: number;
  @ApiProperty({ example: 950000 }) totalMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  holdExpiresAt?: Date;
}

export class FlightBookingListDto extends PageInfoDto {
  @ApiProperty({ enum: BookingGroup }) group: BookingGroup;
  @ApiProperty({ type: [FlightBookingListItemDto] })
  items: FlightBookingListItemDto[];
}

export class CancelledFlightBookingDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: [BookingStatus.CANCELLED] }) status: BookingStatus;
  @ApiProperty({ example: 75 }) refundPercentage: number;
  @ApiProperty({ example: 712500 }) refundMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    enum: ['pending', 'none'],
    description:
      'pending: the refund is recorded and is sent through Stripe by the ' +
      'payment service. none: no refund is due.',
  })
  refundStatus: 'pending' | 'none';
}
