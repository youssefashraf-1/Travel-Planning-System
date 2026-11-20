import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';

export class ListAirportsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Match part of IATA code, name, city id or country code.',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional({ description: 'Two-letter country code.' })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;
}

export class AirportResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() iataCode: string;
  @ApiProperty() name: string;
  @ApiProperty() cityId: string;
  @ApiProperty() countryCode: string;
  @ApiProperty() timeZone: string;
}

export class AirportListResponseDto extends PageInfoDto {
  @ApiProperty({ type: [AirportResponseDto] }) items: AirportResponseDto[];
}
