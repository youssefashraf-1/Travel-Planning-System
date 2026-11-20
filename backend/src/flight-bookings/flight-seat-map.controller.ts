import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SeatMapQueryDto } from './dto/flight-booking-request.dto';
import { SeatMapDto } from './dto/flight-booking-response.dto';
import { FlightSeatsService } from './flight-seats.service';

/** FLT-28 (optional): public seat map, like the flight details page. */
@ApiTags('Flights')
@Controller('flights')
export class FlightSeatMapController {
  constructor(private readonly seats: FlightSeatsService) {}

  @Get(':id/seats')
  @ApiParam({ name: 'id', description: 'The flight id.' })
  @ApiOperation({
    summary: 'Seat map of one cabin (FLT-28, optional)',
    description:
      'Public. Every seat of the cabin and whether it is free. First and ' +
      'business have rows of 4 (A C D F) starting at rows 1 and 3; premium ' +
      'economy and economy have rows of 6 (A–F) starting at rows 12 and 20. ' +
      'Pick a seat with PATCH /api/flight-bookings/{id}/seat.',
  })
  @ApiOkResponse({ type: SeatMapDto })
  @ApiBadRequestResponse({ description: 'Invalid cabin class.' })
  @ApiNotFoundResponse({ description: 'Flight or cabin not found.' })
  seatMap(
    @Param('id') id: string,
    @Query() query: SeatMapQueryDto,
  ): Promise<SeatMapDto> {
    return this.seats.seatMap(id, query.cabinClass);
  }
}
