import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AirportsService } from './airports.service';
import {
  AirportListResponseDto,
  ListAirportsQueryDto,
} from './dto/list-airports.dto';

@ApiTags('Airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Retrieve the read-only airport list (FLT-02)',
    description:
      'Seeded airports, sorted by IATA code; ten per page. Times use the airport IANA time zone.',
  })
  @ApiOkResponse({ type: AirportListResponseDto })
  @ApiBadRequestResponse()
  list(@Query() query: ListAirportsQueryDto) {
    return this.airports.list(query);
  }
}
