import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { BookingStatus } from '../../common/booking-status';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { CabinClass } from '../schemas/cabin-inventory.schema';
import { PassengerType } from '../../flight-bookings/schemas/passenger.schema';

export class ModeratorBookingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    description: 'Defaults to both confirmed and cancelled bookings.',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsIn([BookingStatus.CONFIRMED, BookingStatus.CANCELLED])
  status?: BookingStatus.CONFIRMED | BookingStatus.CANCELLED;
}
export class ModeratorPassengerDto {
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: PassengerType }) type: PassengerType;
  @ApiProperty({ description: 'One for adults/children, zero for infants.' })
  seats: number;
}
export class ModeratorBookingDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() reference: string;
  @ApiProperty({ enum: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED] })
  status: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty() seats: number;
  @ApiProperty({ type: [ModeratorPassengerDto] })
  passengers: ModeratorPassengerDto[];
}
export class ModeratorCabinSeatsDto {
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty() totalSeats: number;
  @ApiProperty() bookedSeats: number;
  @ApiProperty() heldSeats: number;
  @ApiProperty() seatsRemaining: number;
}
export class ModeratorBookingsResponseDto extends PageInfoDto {
  @ApiProperty({ type: [ModeratorBookingDto] }) items: ModeratorBookingDto[];
  @ApiProperty({ type: [ModeratorCabinSeatsDto] })
  inventory: ModeratorCabinSeatsDto[];
}
