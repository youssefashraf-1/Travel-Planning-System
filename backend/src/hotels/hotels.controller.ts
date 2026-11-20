import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiPayloadTooLargeResponse,
} from '@nestjs/swagger';
import {
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from '../common/uploads/image-uploads.service';
import {
  ProviderMediaService,
  ProviderPhotoDto,
} from '../common/uploads/provider-media.service';
import { ConfirmActionDto } from '../common/dto/confirm-action.dto';
import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProviderType } from '../auth/access';
import { ManagesProvider } from '../auth/decorators/manages-provider.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProviderOwnerGuard } from '../auth/guards/provider-owner.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import {
  CalendarQueryDto,
  CreateHotelDto,
  CreateRoomDto,
  DateRangeDto,
  HotelPoliciesDto,
  HotelReservationsQueryDto,
  OptionalStayQueryDto,
  StayQueryDto,
  UpdateAvailabilityDto,
  UpdateHotelDto,
  UpdateRoomDto,
} from './dto/hotel-requests.dto';
import {
  AvailableRoomsDto,
  HotelCalendarDto,
  HotelDetailsDto,
  HotelDto,
  HotelReservationListDto,
  ManagedRoomDto,
  RoomDto,
} from './dto/hotel-responses.dto';
import { HotelsService } from './hotels.service';
import { RoomsService } from './rooms.service';

/** Only the moderator assigned to the hotel in the URL (ACC-13). */
const HotelModerator = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, ProviderOwnerGuard),
    ManagesProvider(ProviderType.HOTEL),
    ApiCookieAuth(),
    ApiUnauthorizedResponse({ description: 'Not logged in.' }),
    ApiForbiddenResponse({
      description: "Only this hotel's own moderator can do this.",
    }),
    ApiNotFoundResponse({ description: 'Hotel or room not found.' }),
  );

const RoomParam = () =>
  ApiParam({ name: 'roomId', description: 'The room id.' });

@ApiTags('Hotels')
@ApiParam({ name: 'id', description: 'The hotel id.' })
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotels: HotelsService,
    private readonly rooms: RoomsService,
    private readonly media: ProviderMediaService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Create a hotel profile (HTL-01)',
    description:
      'Admin only. The city must come from the seeded reference data and ' +
      'match the country. Then create its moderator with ' +
      'POST /api/admin/moderators, who adds rooms and policies.',
  })
  @ApiCreatedResponse({ type: HotelDto })
  @ApiBadRequestResponse({ description: 'Invalid field, city or country.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  @ApiForbiddenResponse({ description: 'Not an administrator.' })
  create(@Body() dto: CreateHotelDto): Promise<HotelDto> {
    return this.hotels.create(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Hotel details (HTL-02)',
    description:
      'Public. Profile, photos, amenities, check-in and check-out times, ' +
      'cancellation tiers, average rating and the newest reviews. Add ' +
      'checkInDate and checkOutDate to include the rooms free for that stay.',
  })
  @ApiOkResponse({ type: HotelDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid or past dates.' })
  @ApiNotFoundResponse({ description: 'Hotel not found.' })
  details(
    @Param('id') id: string,
    @Query() query: OptionalStayQueryDto,
  ): Promise<HotelDetailsDto> {
    return this.hotels.details(id, query);
  }

  @Patch(':id')
  @HotelModerator()
  @ApiOperation({
    summary: "Edit my hotel's profile (HTL-01)",
    description:
      'Name, address, city and country, time zone, description, star ' +
      'class and amenities. Upload photos through the separate photos endpoint.',
  })
  @ApiOkResponse({ type: HotelDto })
  @ApiBadRequestResponse({ description: 'Invalid field, city or country.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
  ): Promise<HotelDto> {
    return this.hotels.update(id, dto);
  }

  @Put(':id/policies')
  @HotelModerator()
  @ApiOperation({
    summary: 'Set check-in/out times and cancellation tiers (HTL-09, HTL-10)',
    description:
      'Replaces the policy. Existing reservations keep the policy they ' +
      'accepted. A hotel needs a policy before it can take bookings.',
  })
  @ApiOkResponse({ type: HotelDto })
  @ApiBadRequestResponse({
    description: 'Invalid time, or two tiers with the same threshold.',
  })
  setPolicies(
    @Param('id') id: string,
    @Body() dto: HotelPoliciesDto,
  ): Promise<HotelDto> {
    return this.hotels.setPolicies(id, dto);
  }

  @Get(':id/rooms')
  @HotelModerator()
  @ApiOperation({
    summary: "List my hotel's rooms with their date ranges",
    description: 'Every room, active or not, with bookable and blocked ranges.',
  })
  @ApiOkResponse({ type: [ManagedRoomDto] })
  listRooms(@Param('id') id: string): Promise<ManagedRoomDto[]> {
    return this.rooms.listRooms(id);
  }

  @Post(':id/rooms')
  @HotelModerator()
  @ApiOperation({
    summary: 'Add a room (HTL-03)',
    description:
      'An individually bookable unit with a label unique in the hotel ' +
      '(ignoring case). Add bookable dates afterwards (HTL-04).',
  })
  @ApiCreatedResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'Invalid field.' })
  @ApiConflictResponse({ description: 'The label is already used.' })
  createRoom(
    @Param('id') id: string,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.createRoom(id, dto);
  }

  @Get(':id/rooms/available')
  @ApiOperation({
    summary: 'Rooms free for a stay (HTL-15)',
    description:
      'Public. Active rooms free for every night, with type, beds, ' +
      'occupancy, nightly price and stay price, cheapest first. Dates are ' +
      'in the hotel calendar: check-in not in the past, check-out after it.',
  })
  @ApiOkResponse({ type: AvailableRoomsDto })
  @ApiBadRequestResponse({ description: 'Invalid or past dates.' })
  @ApiNotFoundResponse({ description: 'Hotel not found.' })
  availableRooms(
    @Param('id') id: string,
    @Query() query: StayQueryDto,
  ): Promise<AvailableRoomsDto> {
    return this.rooms.availableRooms(id, query);
  }

  @Patch(':id/rooms/:roomId')
  @HotelModerator()
  @RoomParam()
  @ApiOperation({
    summary: 'Edit or deactivate a room (HTL-05, HTL-06)',
    description:
      'Beds, occupancy, price, type, label or isActive. Price changes do ' +
      'not affect existing reservations. Deactivation is refused while ' +
      'the room has a confirmed or held reservation that has not ended.',
  })
  @ApiOkResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'Invalid field.' })
  @ApiConflictResponse({
    description: 'Label already used, or reservations block deactivation.',
  })
  updateRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomDto> {
    return this.rooms.updateRoom(id, roomId, dto);
  }

  @Delete(':id/rooms/:roomId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HotelModerator()
  @RoomParam()
  @ApiOperation({
    summary: 'Delete a room that was never reserved (HTL-06)',
    description:
      'A room with any reservation, past or present, can only be deactivated.',
  })
  @ApiNoContentResponse({ description: 'Room deleted.' })
  @ApiConflictResponse({ description: 'The room has been reserved before.' })
  deleteRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<void> {
    return this.rooms.deleteRoom(id, roomId);
  }

  @Post(':id/rooms/:roomId/availability')
  @HotelModerator()
  @RoomParam()
  @ApiOperation({
    summary: 'Add a bookable date range (HTL-04)',
    description:
      'fromDate is the first night; untilDate is not included. Must not ' +
      "overlap the room's other bookable ranges.",
  })
  @ApiCreatedResponse({ type: ManagedRoomDto })
  @ApiBadRequestResponse({ description: 'untilDate is not after fromDate.' })
  @ApiConflictResponse({ description: 'Overlaps an existing bookable range.' })
  addBookableRange(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: DateRangeDto,
  ): Promise<ManagedRoomDto> {
    return this.rooms.addBookableRange(id, roomId, dto);
  }

  @Patch(':id/rooms/:roomId/availability')
  @HotelModerator()
  @RoomParam()
  @ApiOperation({
    summary: 'Replace bookable or blocked ranges (HTL-05, HTL-06)',
    description:
      'Send bookableRanges and/or blockedRanges; each list replaces the ' +
      "current one. Dates under a confirmed or held reservation that hasn't " +
      'ended can neither lose availability nor be blocked.',
  })
  @ApiOkResponse({ type: ManagedRoomDto })
  @ApiBadRequestResponse({
    description: 'Empty request, or ranges that are reversed or overlap.',
  })
  @ApiConflictResponse({ description: 'A reservation uses those dates.' })
  updateAvailability(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<ManagedRoomDto> {
    return this.rooms.updateAvailability(id, roomId, dto);
  }

  @Get(':id/availability')
  @HotelModerator()
  @ApiOperation({
    summary: "Each room's status per day (HTL-08)",
    description:
      'Up to 62 days: available, booked (with reference), held (awaiting ' +
      'payment), blocked, inactive, or not_bookable (outside every ' +
      'bookable range).',
  })
  @ApiOkResponse({ type: HotelCalendarDto })
  @ApiBadRequestResponse({ description: 'Invalid range or more than 62 days.' })
  calendar(
    @Param('id') id: string,
    @Query() query: CalendarQueryDto,
  ): Promise<HotelCalendarDto> {
    return this.rooms.calendar(id, query);
  }

  @Get(':id/reservations')
  @HotelModerator()
  @ApiOperation({
    summary: "My hotel's reservations (HTL-22)",
    description:
      'Guest, dates, rooms and status, latest check-in first, 10 per page. ' +
      'Optionally filter by status.',
  })
  @ApiOkResponse({ type: HotelReservationListDto })
  @ApiBadRequestResponse({ description: 'Invalid page or status.' })
  reservations(
    @Param('id') id: string,
    @Query() query: HotelReservationsQueryDto,
  ): Promise<HotelReservationListDto> {
    return this.hotels.reservations(id, query);
  }

  @Post(':id/photos')
  @HotelModerator()
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a hotel photo (HTL-01, GEN-08)',
    description:
      'Own moderator only. JPG/PNG up to 5 MB; five photos maximum, including simultaneous uploads. Returns photo ids and URLs.',
  })
  @ApiCreatedResponse({ type: [ProviderPhotoDto] })
  @ApiBadRequestResponse()
  @ApiConflictResponse({ description: 'Already five photos or hotel changed.' })
  @ApiPayloadTooLargeResponse()
  photo(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.media.addPhoto(id, file);
  }

  @Delete(':id/photos/:photoId')
  @HotelModerator()
  @ApiOperation({
    summary: 'Remove a hotel photo (HTL-01, GEN-08)',
    description:
      'Own moderator only; requires confirm:true. Removes the stored file and returns remaining photos.',
  })
  @ApiOkResponse({ type: [ProviderPhotoDto] })
  removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body() _dto: ConfirmActionDto,
  ) {
    return this.media.removePhoto(id, photoId);
  }
}
