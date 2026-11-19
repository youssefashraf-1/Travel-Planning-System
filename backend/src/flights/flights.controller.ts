import { FlightBookingViewsService } from './flight-booking-views.service';
import {
  ModeratorBookingsQueryDto,
  ModeratorBookingsResponseDto,
} from './dto/moderator-bookings.dto';
import { FlightManagementService } from './flight-management.service';
import {
  CancelFlightDto,
  CancelFlightResponseDto,
  UpdateCabinDto,
  UpdateFlightDto,
} from './dto/manage-flight.dto';
import {
  Body,
  Controller,
  HttpCode,
  Get,
  Header,
  Query,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProduces,
  ApiOkResponse,
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
  constructor(
    private readonly flights: FlightsService,
    private readonly management: FlightManagementService,
    private readonly bookingViews: FlightBookingViewsService,
  ) {}

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
  @Patch(':id')
  @ApiOperation({
    summary: 'Edit your scheduled flight (FLT-05)',
    description:
      'Local time edits notify confirmed booking owners. Airports cannot change after any booking. Prices already quoted in bookings are preserved.',
  })
  @ApiOkResponse({ type: FlightResponseDto })
  update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateFlightDto,
  ) {
    return this.management.update(user, id, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @ApiOperation({
    summary: 'Edit a cabin and capacity safely (FLT-04, FLT-05)',
    description:
      'Only the owning moderator of a scheduled future flight. Capacity cannot drop below booked plus held seats; booking price snapshots do not change. Class and counters cannot be set.',
  })
  @ApiOkResponse({ type: CabinResponseDto })
  updateCabin(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('cabinId') cabinId: string,
    @Body() dto: UpdateCabinDto,
  ) {
    return this.management.updateCabin(user, id, cabinId, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel your flight after confirmation (FLT-06)',
    description:
      'Requires confirm=true. Atomically cancels affected whole bookings, expires pending holds, releases all their segment seats and notifies owners. Full refund records are queued as pending; sending refunds through Stripe is the Phase 9 PAY-03 integration, not completed by this endpoint.',
  })
  @ApiOkResponse({ type: CancelFlightResponseDto })
  cancel(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _dto: CancelFlightDto,
  ) {
    return this.management.cancel(user, id);
  }
  @Get(':id/bookings')
  @ApiOperation({
    summary: 'View your flight bookings and remaining seats (FLT-29)',
    description:
      'Only the assigned airline moderator. Confirmed/cancelled bookings, ten per page, with passenger names and this flight segment only. No birth dates, passport numbers, contact details or other-provider segments are returned.',
  })
  @ApiOkResponse({ type: ModeratorBookingsResponseDto })
  bookings(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query() query: ModeratorBookingsQueryDto,
  ) {
    return this.bookingViews.list(user, id, query);
  }

  @Get(':id/passengers/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="passengers.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Export your flight passenger list as CSV (FLT-29)',
    description:
      'Only the owning moderator. All matching confirmed/cancelled passenger rows are exported; page is ignored for the download. Spreadsheet formula characters are escaped. No passport numbers, birth dates or contact details.',
  })
  @ApiOkResponse({ schema: { type: 'string' } })
  exportPassengers(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query() query: ModeratorBookingsQueryDto,
  ) {
    return this.bookingViews.exportCsv(user, id, query);
  }
}
