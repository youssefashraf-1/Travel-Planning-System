import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateFlightDto {
  @ApiProperty({ example: 'MS777' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  flightNumber: string;

  @ApiProperty({ description: 'Airport _id from GET /api/airports.' })
  @IsMongoId()
  departureAirportId: string;

  @ApiProperty({
    description:
      'Airport _id from GET /api/airports; must differ from departure.',
  })
  @IsMongoId()
  arrivalAirportId: string;

  @ApiProperty({
    example: '2027-06-15T10:30',
    description:
      'Local date-time at the departure airport. No UTC offset or Z. Nonexistent/repeated DST times are rejected.',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  departureLocalDateTime: string;

  @ApiProperty({
    example: '2027-06-15T14:30',
    description:
      'Local date-time at the arrival airport, converted separately to UTC.',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  arrivalLocalDateTime: string;
}
