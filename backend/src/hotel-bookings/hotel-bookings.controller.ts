import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  CancelHotelBookingDto,
  CancelledHotelBookingDto,
  CreateHotelBookingDto,
  HotelBookingDto,
  HotelBookingListDto,
  ListHotelBookingsQueryDto,
} from './dto/hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('Hotel bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({ description: 'Only travelers book hotels.' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAVELER)
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly hotelBookings: HotelBookingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Reserve rooms and hold them for 10 minutes (HTL-16, HTL-18)',
    description:
      'One or more rooms of one hotel for the same dates, with adults and ' +
      'children (ages 0–17) per room. All rooms are held together as one ' +
      'Pending Payment reservation, or nothing is held if any room is not ' +
      'free for the whole stay. The total is nights × each room’s nightly ' +
      'price. Pay before holdExpiresAt (HTL-17, PAY-01) or the hold expires.',
  })
  @ApiCreatedResponse({ type: HotelBookingDto })
  @ApiBadRequestResponse({
    description:
      'Invalid or past dates, no adult, an empty or overfull room, or a ' +
      'room selected twice.',
  })
  @ApiNotFoundResponse({ description: 'Hotel or room not found.' })
  @ApiConflictResponse({
    description: 'A room is not free, or the hotel is not taking bookings.',
  })
  create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateHotelBookingDto,
  ): Promise<HotelBookingDto> {
    return this.hotelBookings.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'My hotel reservations (HTL-20)',
    description:
      'One group at a time, 10 per page: upcoming (held or confirmed), ' +
      'past (completed) or cancelled (cancelled or expired holds).',
  })
  @ApiOkResponse({ type: HotelBookingListDto })
  @ApiBadRequestResponse({ description: 'Invalid group or page.' })
  list(
    @CurrentUser() user: UserDocument,
    @Query() query: ListHotelBookingsQueryDto,
  ): Promise<HotelBookingListDto> {
    return this.hotelBookings.list(user, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'The reservation id.' })
  @ApiOperation({
    summary: 'One of my hotel reservations (HTL-20)',
    description:
      'Full details, including check-in and check-out times. For a ' +
      'confirmed reservation, cancellation shows the refund a ' +
      'cancellation would give now (HTL-21).',
  })
  @ApiOkResponse({ type: HotelBookingDto })
  @ApiNotFoundResponse({ description: 'Not found, or not your reservation.' })
  details(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<HotelBookingDto> {
    return this.hotelBookings.details(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'The reservation id.' })
  @ApiOperation({
    summary: 'Cancel my confirmed reservation (HTL-21)',
    description:
      'The whole reservation, before the check-in date. All its rooms are ' +
      'free again, and the refund follows the hotel’s tiers on the full ' +
      'total. The refund stays pending until the payment service sends it.',
  })
  @ApiOkResponse({ type: CancelledHotelBookingDto })
  @ApiBadRequestResponse({ description: 'confirm is not true.' })
  @ApiNotFoundResponse({ description: 'Not found, or not your reservation.' })
  @ApiConflictResponse({
    description: 'Not confirmed, or the check-in date has come.',
  })
  cancel(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _dto: CancelHotelBookingDto,
  ): Promise<CancelledHotelBookingDto> {
    return this.hotelBookings.cancel(user, id);
  }
}
