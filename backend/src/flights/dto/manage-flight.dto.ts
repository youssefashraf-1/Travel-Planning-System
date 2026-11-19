import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';
import { CreateFlightDto } from './create-flight.dto';
import { CreateCabinDto } from './create-cabin.dto';

export class UpdateFlightDto extends PartialType(
  OmitType(CreateFlightDto, ['flightNumber'] as const),
  { skipNullProperties: false },
) {}
export class UpdateCabinDto extends PartialType(
  OmitType(CreateCabinDto, ['cabinClass'] as const),
  { skipNullProperties: false },
) {}
export class CancelFlightDto {
  @ApiProperty({
    example: true,
    description:
      'Must explicitly be true. Cancels the flight and whole affected round-trip bookings.',
  })
  @IsBoolean()
  @Equals(true)
  confirm: boolean;
}
export class CancelFlightResponseDto {
  @ApiProperty() flightId: string;
  @ApiProperty({ enum: ['cancelled'] }) status: string;
  @ApiProperty() cancelledBookings: number;
  @ApiProperty() expiredHolds: number;
  @ApiProperty({
    description:
      'Full refund records queued; actual Stripe processing is Phase 9, not completed by this response.',
  })
  pendingRefunds: number;
}
