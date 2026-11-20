import { ProviderPhotoDto } from '../../common/uploads/provider-media.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/booking-status';
import { PageInfoDto } from '../../common/pagination';
import { ReviewDto } from '../../reviews/dto/review.dto';

export class HotelPolicyViewDto {
  @ApiProperty({ example: '14:00' }) checkInTime: string;
  @ApiProperty({ example: '12:00' }) checkOutTime: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ daysBeforeCheckIn: 7, refundPercentage: 50 }],
  })
  cancellationTiers: { daysBeforeCheckIn: number; refundPercentage: number }[];
}

export class HotelDto {
  @ApiProperty({ type: [ProviderPhotoDto] }) photos: ProviderPhotoDto[];
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Nile View Hotel' }) name: string;
  @ApiProperty() address: string;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty({ example: 'Cairo' }) cityName: string;
  @ApiProperty({ example: 'EG' }) countryCode: string;
  @ApiProperty({ example: 'Egypt' }) countryName: string;
  @ApiProperty({ example: 'Africa/Cairo' }) timeZone: string;
  @ApiProperty() description: string;
  @ApiProperty({ example: 4 }) starClass: number;
  @ApiProperty({ type: [String] }) amenities: string[];
  @ApiProperty({ type: [String] }) photoUrls: string[];
  @ApiPropertyOptional({
    type: HotelPolicyViewDto,
    description: 'Missing until the moderator sets the policies (HTL-09).',
  })
  policy?: HotelPolicyViewDto;
  @ApiProperty({ description: 'Inactive hotels are hidden from search.' })
  isActive: boolean;
  @ApiProperty({
    description: 'Active and has its policies set, so it can take bookings.',
  })
  canBook: boolean;
  @ApiPropertyOptional({
    example: 4.3,
    description: 'One decimal; none if unrated.',
  })
  averageRating?: number;
  @ApiProperty({ example: 12 }) ratingCount: number;
}

export class RoomDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: '204' }) label: string;
  @ApiProperty({ example: 'Double' }) roomType: string;
  @ApiProperty({ example: 2 }) bedCount: number;
  @ApiProperty({ example: 3 }) maxOccupancy: number;
  @ApiProperty({ example: 250000 }) nightlyPriceMinorUnits: number;
  @ApiProperty() isActive: boolean;
}

export class DateRangeViewDto {
  @ApiProperty({ example: '2027-01-01' }) fromDate: string;
  @ApiProperty({ example: '2027-04-01' }) untilDate: string;
}

export class ManagedRoomDto extends RoomDto {
  @ApiProperty({ type: [DateRangeViewDto] })
  bookableRanges: DateRangeViewDto[];
  @ApiProperty({ type: [DateRangeViewDto] })
  blockedRanges: DateRangeViewDto[];
}

/** HTL-15: a room free for every night of the stay. */
export class AvailableRoomDto extends RoomDto {
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ example: 750000, description: 'nights × nightly price' })
  stayPriceMinorUnits: number;
}

export class AvailableRoomsDto {
  @ApiProperty({ example: '2027-02-10' }) checkInDate: string;
  @ApiProperty({ example: '2027-02-13' }) checkOutDate: string;
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({ type: [AvailableRoomDto] }) rooms: AvailableRoomDto[];
}

export class HotelDetailsDto extends HotelDto {
  @ApiProperty({
    type: [ReviewDto],
    description: 'The 5 newest reviews; see /hotels/:id/reviews for all.',
  })
  latestReviews: ReviewDto[];
  @ApiPropertyOptional({
    type: AvailableRoomsDto,
    description: 'Present when checkInDate and checkOutDate are given.',
  })
  availability?: AvailableRoomsDto;
}

export enum RoomDayStatus {
  AVAILABLE = 'available',
  BOOKED = 'booked',
  HELD = 'held',
  BLOCKED = 'blocked',
  NOT_BOOKABLE = 'not_bookable',
  INACTIVE = 'inactive',
}

export class RoomDayDto {
  @ApiProperty({ example: '2027-02-01' }) date: string;
  @ApiProperty({
    enum: RoomDayStatus,
    description:
      'booked: a confirmed or completed stay (reference given). held: a ' +
      'payment hold. not_bookable: outside every bookable range.',
  })
  status: RoomDayStatus;
  @ApiPropertyOptional({ example: 'K7Q2MX' }) reference?: string;
}

export class RoomCalendarDto {
  @ApiProperty() roomId: string;
  @ApiProperty({ example: '204' }) label: string;
  @ApiProperty({ type: [RoomDayDto] }) days: RoomDayDto[];
}

export class HotelCalendarDto {
  @ApiProperty({ example: '2027-02-01' }) fromDate: string;
  @ApiProperty({ example: '2027-03-01' }) untilDate: string;
  @ApiProperty({ type: [RoomCalendarDto] }) rooms: RoomCalendarDto[];
}

export class HotelReservationDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ example: 'K7Q2MX' }) reference?: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({ example: 'Mona Hassan' }) guestName: string;
  @ApiProperty({ example: '2027-02-10' }) checkInDate: string;
  @ApiProperty({ example: '2027-02-13' }) checkOutDate: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ label: '204', adults: 2, children: 1 }],
  })
  rooms: { roomId: string; label: string; adults: number; children: number }[];
  @ApiProperty({ example: 750000 }) totalMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
}

export class HotelReservationListDto extends PageInfoDto {
  @ApiProperty({ type: [HotelReservationDto] }) items: HotelReservationDto[];
}
