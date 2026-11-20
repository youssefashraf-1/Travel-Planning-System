import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  HotelSearchResultDto,
  SearchHotelsQueryDto,
} from './dto/hotel-search.dto';
import { HotelSearchService } from './hotel-search.service';

/**
 * Registered before HotelsController so /hotels/search is not read as a
 * hotel id.
 */
@ApiTags('Hotels')
@Controller('hotels')
export class HotelSearchController {
  constructor(private readonly search: HotelSearchService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search hotels (HTL-11, HTL-12)',
    description:
      'Public. Active hotels in a city or country with at least `rooms` ' +
      'rooms free for every night whose combined occupancy fits the ' +
      'guests. Filter by the cheapest free room’s nightly price and by ' +
      'minimum rating; sort by that price or by rating. 10 per page.',
  })
  @ApiOkResponse({ type: HotelSearchResultDto })
  @ApiBadRequestResponse({
    description:
      'No city or country, past or reversed dates, min price above max, ' +
      'or fewer guests than rooms.',
  })
  find(@Query() query: SearchHotelsQueryDto): Promise<HotelSearchResultDto> {
    return this.search.search(query);
  }
}
