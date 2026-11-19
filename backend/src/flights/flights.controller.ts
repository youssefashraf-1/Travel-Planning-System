import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CabinResponseDto, FlightResponseDto } from './dto/flight-response.dto';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@ApiCookieAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@ApiBadRequestResponse()
@ApiNotFoundResponse()
@ApiConflictResponse()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AIRLINE_MODERATOR)
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a flight for your assigned airline (FLT-03, FLT-30)',
    description:
      'Enter local date-times at each airport; UTC dates and local time zones are returned. Duplicate flight numbers are scoped to airline and departure local date. Airline and status are server-controlled.',
  })
  @ApiCreatedResponse({ type: FlightResponseDto })
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateFlightDto) {
    return this.flights.create(user, dto);
  }

  @Post(':id/cabins')
  @ApiOperation({
    summary: 'Add a cabin to your scheduled flight (FLT-04, FLT-30)',
    description:
      'Each class can occur once per flight. Inventory starts with zero held/booked seats. Only the airline assigned to the moderator can manage it.',
  })
  @ApiCreatedResponse({ type: CabinResponseDto })
  createCabin(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CreateCabinDto,
  ) {
    return this.flights.createCabin(user, id, dto);
  }
}
