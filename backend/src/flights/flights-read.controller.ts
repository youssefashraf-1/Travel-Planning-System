import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  FlightDetailsDto,
  FlightSearchResponseDto,
} from './dto/flight-details.dto';
import { SearchFlightsDto } from './dto/search-flights.dto';
import { FlightSearchService } from './flight-search.service';

/** Public reads are separate from the moderator-only write controller. */
@ApiTags('Flights')
@Controller('flights')
export class FlightsReadController {
  constructor(private readonly searchService: FlightSearchService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search one-way or round-trip flights (FLT-11, FLT-12, FLT-15)',
    description:
      'Public. Only future scheduled flights of active airlines with enough seats in one matching cabin. Adults and children need seats; infants do not. Price range is inclusive per adult/child cabin fare. Ten flights per page per leg; sort/filter criteria apply to both legs. Return date is local at the reverse-route departure airport. An empty result returns 200. Search does not reserve seats; final availability and compatible segment timing are checked at booking.',
  })
  @ApiOkResponse({ type: FlightSearchResponseDto })
  @ApiBadRequestResponse()
  search(@Query() query: SearchFlightsDto) {
    return this.searchService.search(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'View flight details (FLT-17, GEN-06, FLT-30)',
    description:
      'Public. Includes airline policies, airports, local and UTC times, duration, each cabin fare, remaining seats and free baggage. Cancelled/departed flights and inactive airlines remain viewable with canBook=false.',
  })
  @ApiOkResponse({ type: FlightDetailsDto })
  @ApiNotFoundResponse()
  details(@Param('id') id: string) {
    return this.searchService.details(id);
  }
}
