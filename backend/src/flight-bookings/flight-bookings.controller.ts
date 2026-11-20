import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  CancelFlightBookingDto,
  ChangeFlightDto,
  ChooseSeatDto,
  FlightBookingRequestDto,
} from './dto/flight-booking-request.dto';
import {
  CancelledFlightBookingDto,
  ChangeFlightResultDto,
  FlightBookingDto,
  FlightBookingListDto,
  FlightBookingSummaryDto,
  ListFlightBookingsQueryDto,
} from './dto/flight-booking-response.dto';
import { buildETicketPdf } from './e-ticket-pdf';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightChangesService } from './flight-changes.service';
import { FlightSeatsService } from './flight-seats.service';

@ApiTags('Flight bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({ description: 'Only travelers book flights.' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAVELER)
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly flightBookings: FlightBookingsService,
    private readonly changes: FlightChangesService,
    private readonly seats: FlightSeatsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Price a booking and show its summary (FLT-19, FLT-21)',
    description:
      'Checks the flights, cabin, passengers and extra bags, and returns ' +
      'fares, baggage fees and the total in EGP minor units (piastres). ' +
      'Nothing is reserved yet; send the same body to /hold to reserve. ' +
      'Each passenger type must match their date of birth on the outbound ' +
      'date: adult 12+, child 2–11, infant under 2 (10% fare, no seat).',
  })
  @ApiOkResponse({ type: FlightBookingSummaryDto })
  @ApiBadRequestResponse({
    description:
      'Invalid passengers or bags, a wrong round-trip route, or no adult.',
  })
  @ApiNotFoundResponse({ description: 'Flight or cabin not found.' })
  @ApiConflictResponse({
    description: 'Flight not open for booking or not enough seats left.',
  })
  quote(
    @Body() dto: FlightBookingRequestDto,
  ): Promise<FlightBookingSummaryDto> {
    return this.flightBookings.quote(dto);
  }

  @Post('hold')
  @ApiOperation({
    summary: 'Hold the seats for 10 minutes (FLT-22)',
    description:
      'Reserves the seats and creates a Pending Payment booking. Pay ' +
      'before holdExpiresAt or the booking becomes Expired and the seats ' +
      'are released. Payment confirms it, sets the reference and enables ' +
      'the e-ticket (FLT-23, PAY-01). Simultaneous requests never take ' +
      'more seats than remain.',
  })
  @ApiCreatedResponse({ type: FlightBookingDto })
  @ApiBadRequestResponse({ description: 'Invalid booking details.' })
  @ApiNotFoundResponse({ description: 'Flight or cabin not found.' })
  @ApiConflictResponse({
    description: 'Flight not open for booking or not enough seats left.',
  })
  hold(
    @CurrentUser() user: UserDocument,
    @Body() dto: FlightBookingRequestDto,
  ): Promise<FlightBookingDto> {
    return this.flightBookings.hold(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'My flight bookings (FLT-25)',
    description:
      'One group at a time, 10 per page: upcoming (held or confirmed, not ' +
      'yet departed), past (completed or departed) or cancelled ' +
      '(cancelled or expired holds).',
  })
  @ApiOkResponse({ type: FlightBookingListDto })
  @ApiBadRequestResponse({ description: 'Invalid group or page.' })
  list(
    @CurrentUser() user: UserDocument,
    @Query() query: ListFlightBookingsQueryDto,
  ): Promise<FlightBookingListDto> {
    return this.flightBookings.list(user, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'The booking id.' })
  @ApiOperation({
    summary: 'One of my flight bookings (FLT-25)',
    description:
      'Full details. For a confirmed booking, cancellation shows the ' +
      'refund a cancellation would give now (FLT-26). Passport and ID ' +
      'numbers show only their last four characters.',
  })
  @ApiOkResponse({ type: FlightBookingDto })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  details(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<FlightBookingDto> {
    return this.flightBookings.details(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'The booking id.' })
  @ApiOperation({
    summary: 'Cancel my confirmed booking (FLT-26)',
    description:
      'Allowed until the outbound flight departs. A round trip is ' +
      'cancelled as a whole. Seats return to inventory and the refund ' +
      "follows the outbound airline's cancellation tiers. The refund is " +
      'recorded as pending until the payment service sends it.',
  })
  @ApiOkResponse({ type: CancelledFlightBookingDto })
  @ApiBadRequestResponse({ description: 'confirm is not true.' })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  @ApiConflictResponse({
    description: 'Not confirmed, or the flight already departed.',
  })
  cancel(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _dto: CancelFlightBookingDto,
  ): Promise<CancelledFlightBookingDto> {
    return this.flightBookings.cancel(user, id);
  }

  @Patch(':id/change-flight')
  @ApiParam({ name: 'id', description: 'The booking id.' })
  @ApiOperation({
    summary: 'Change one flight to another date or flight (FLT-27, optional)',
    description:
      'For a confirmed booking, before that flight departs. The new flight ' +
      'must fly the same route with the same cabin class, keep a round ' +
      'trip in order and have enough seats. Extra bags are kept and priced ' +
      "with the new airline's policy; chosen seats on that flight are " +
      'cleared. Send previewOnly=true to see the fare difference first. ' +
      'Same or lower total: changed at once and any difference is refunded ' +
      'to the card. Higher total: the new seats are held for 10 minutes; ' +
      'pay the difference with POST /api/payments { bookingType: ' +
      '"flight_change", bookingId: changeId } and the change completes ' +
      'when the payment succeeds.',
  })
  @ApiOkResponse({ type: ChangeFlightResultDto })
  @ApiBadRequestResponse({
    description:
      'Different route, same flight, wrong round-trip order, or passengers or bags not allowed on the new flight.',
  })
  @ApiNotFoundResponse({
    description: 'Not found, not your booking, or no such flight or cabin.',
  })
  @ApiConflictResponse({
    description:
      'Not confirmed, already departed, a change already waiting for payment, or not enough seats.',
  })
  changeFlight(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ChangeFlightDto,
  ): Promise<ChangeFlightResultDto> {
    return this.changes.change(user, id, dto);
  }

  @Patch(':id/seat')
  @ApiParam({ name: 'id', description: 'The booking id.' })
  @ApiOperation({
    summary: 'Choose a seat for one passenger (FLT-28, optional)',
    description:
      'For a held or confirmed booking, before that flight departs. See ' +
      'free seats with GET /api/flights/{id}/seats. Infants have no seat. ' +
      'Choosing again moves the passenger; two travelers can never get the ' +
      'same seat.',
  })
  @ApiOkResponse({ type: FlightBookingDto })
  @ApiBadRequestResponse({
    description:
      'No such leg, passenger or seat, or the passenger is an infant.',
  })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  @ApiConflictResponse({
    description: 'Booking not active, flight departed, or seat taken.',
  })
  chooseSeat(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ChooseSeatDto,
  ): Promise<FlightBookingDto> {
    return this.seats.chooseSeat(user, id, dto);
  }

  @Get(':id/e-ticket')
  @ApiParam({ name: 'id', description: 'The booking id.' })
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Download my e-ticket as a PDF (FLT-23)',
    description: 'Available for confirmed and completed bookings.',
  })
  @ApiOkResponse({
    description: 'The e-ticket PDF.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiNotFoundResponse({ description: 'Not found, or not your booking.' })
  @ApiConflictResponse({ description: 'The booking is not confirmed.' })
  async eTicket(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const booking = await this.flightBookings.ticket(user, id);
    return new StreamableFile(buildETicketPdf(booking), {
      type: 'application/pdf',
      disposition: `attachment; filename="e-ticket-${booking.reference}.pdf"`,
    });
  }
}
