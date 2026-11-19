import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  FlightBookingRequestDto,
} from './dto/flight-booking-request.dto';
import {
  CancelledFlightBookingDto,
  FlightBookingDto,
  FlightBookingListDto,
  FlightBookingSummaryDto,
  ListFlightBookingsQueryDto,
} from './dto/flight-booking-response.dto';
import { buildETicketPdf } from './e-ticket-pdf';
import { FlightBookingsService } from './flight-bookings.service';

@ApiTags('Flight bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({ description: 'Only travelers book flights.' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAVELER)
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly flightBookings: FlightBookingsService) {}

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
