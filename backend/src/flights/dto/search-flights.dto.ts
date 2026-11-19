import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { CabinClass } from '../schemas/cabin-inventory.schema';

const queryInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
export enum FlightSort {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE = 'departureTime',
}
export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class SearchFlightsDto extends PageQueryDto {
  @ApiProperty({ description: 'Departure airport _id from GET /api/airports.' })
  @IsMongoId()
  departureAirportId: string;

  @ApiProperty({ description: 'Arrival airport _id from GET /api/airports.' })
  @IsMongoId()
  arrivalAirportId: string;

  @ApiProperty({
    description: 'YYYY-MM-DD, local date at the departure airport.',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  departureDate: string;

  @ApiPropertyOptional({
    description:
      'Supply for round trip. YYYY-MM-DD, local date at the return departure airport. Cannot be earlier than departureDate.',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  returnDate?: string;

  @ApiPropertyOptional({
    description: 'Adults aged 12+. Defaults to 1.',
    minimum: 1,
  })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  adults: number = 1;

  @ApiPropertyOptional({
    description: 'Children aged 2–11. Defaults to 0. Each occupies a seat.',
    minimum: 0,
  })
  @Transform(queryInteger)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  children: number = 0;

  @ApiPropertyOptional({
    description:
      'Infants under 2. Defaults to 0. No seat; at most one per adult. Booking fare is 10% of cabin fare.',
    minimum: 0,
  })
  @Transform(queryInteger)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  infants: number = 0;

  @ApiPropertyOptional({ enum: CabinClass })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional({
    description:
      'Inclusive minimum cabin fare per adult/child, in minor units; not the total party fare.',
    minimum: 0,
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(queryInteger)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  minPriceMinorUnits?: number;

  @ApiPropertyOptional({
    description:
      'Inclusive maximum cabin fare per adult/child, in minor units.',
    minimum: 0,
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(queryInteger)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxPriceMinorUnits?: number;

  @ApiPropertyOptional({
    enum: FlightSort,
    description:
      'Defaults to departureTime. Price uses the cheapest matching cabin.',
  })
  @IsEnum(FlightSort)
  sortBy: FlightSort = FlightSort.DEPARTURE;

  @ApiPropertyOptional({ enum: SortOrder, description: 'Defaults to asc.' })
  @IsEnum(SortOrder)
  sortOrder: SortOrder = SortOrder.ASC;
}
