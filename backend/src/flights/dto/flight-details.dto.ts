import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AirlineResponseDto } from '../../airlines/dto/airline.dto';
import { AirportResponseDto } from '../../airports/dto/list-airports.dto';
import { PageInfoDto } from '../../common/pagination';
import { CabinClass } from '../schemas/cabin-inventory.schema';
import { FlightResponseDto } from './flight-response.dto';

export class PublicCabinDto {
  @ApiProperty() _id: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty() priceMinorUnits: number;
  @ApiProperty() seatsRemaining: number;
  @ApiProperty() freeBagCount: number;
  @ApiProperty() maxBagWeightKg: number;
}

export class FlightDetailsDto extends FlightResponseDto {
  @ApiProperty({ type: AirlineResponseDto }) airline: AirlineResponseDto;
  @ApiProperty({ type: AirportResponseDto })
  departureAirport: AirportResponseDto;
  @ApiProperty({ type: AirportResponseDto }) arrivalAirport: AirportResponseDto;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ type: [PublicCabinDto] }) cabins: PublicCabinDto[];
  @ApiProperty({
    description:
      'False for departed/cancelled flights, inactive airlines, or no available cabin seats. Search is availability, not a seat hold.',
  })
  canBook: boolean;
}

export class FlightSearchItemDto extends FlightDetailsDto {
  @ApiProperty({
    description:
      'Cheapest fare among cabins matching all filters. Per adult/child, in minor units.',
  })
  priceMinorUnits: number;
}

export class FlightSearchPageDto extends PageInfoDto {
  @ApiProperty({ type: [FlightSearchItemDto] }) items: FlightSearchItemDto[];
}

export class SearchPassengersDto {
  @ApiProperty() adults: number;
  @ApiProperty() children: number;
  @ApiProperty() infants: number;
  @ApiProperty({
    description: 'Adults plus children; infants do not occupy seats.',
  })
  seatsRequired: number;
}

export class FlightSearchResponseDto {
  @ApiProperty({ enum: ['one_way', 'round_trip'] }) tripType: string;
  @ApiProperty({ type: SearchPassengersDto }) passengers: SearchPassengersDto;
  @ApiProperty({ type: FlightSearchPageDto }) outbound: FlightSearchPageDto;
  @ApiPropertyOptional({
    type: FlightSearchPageDto,
    description:
      'For round trips only. Reversed airports; returnDate is local at that departure airport. Same filters and page apply independently to each leg. Choose a return departing after the selected outbound arrival; enforced when booking.',
  })
  return?: FlightSearchPageDto;
}
