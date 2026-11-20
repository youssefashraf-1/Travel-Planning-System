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
  Query,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PageQueryDto } from '../common/pagination';
import {
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from '../common/uploads/image-uploads.service';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  CreateActivityDto,
  CreateBudgetDto,
  CreateDayDto,
  CreateItineraryDto,
  CreateTransportCostDto,
  LinkBookingDto,
  CurrencyQueryDto,
  ItineraryFlightsQueryDto,
  ItineraryHotelsQueryDto,
  PublicSearchQueryDto,
  ReorderDaysDto,
  UpdateActivityDto,
  UpdateBudgetDto,
  UpdateDayDto,
  UpdateItineraryDto,
  UpdateTransportCostDto,
} from './dto/itinerary-requests.dto';
import {
  BudgetSummaryDto,
  ItineraryDetailsDto,
  ItineraryListDto,
  PublicItineraryViewDto,
  PublicSearchResultDto,
} from './dto/itinerary-responses.dto';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgetService } from './itinerary-budget.service';
import { StoredItinerary } from './itinerary-presenter';
import { buildItineraryPdf } from './itinerary-pdf';
import { ItineraryPublicService } from './itinerary-public.service';

/** Signed-in travelers only; others' itineraries answer 404 (ACC-11). */
const Owner = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(UserRole.TRAVELER),
    ApiCookieAuth(),
    ApiUnauthorizedResponse({ description: 'Not logged in.' }),
    ApiForbiddenResponse({ description: 'Only travelers have itineraries.' }),
    ApiNotFoundResponse({ description: 'Not found, or not your itinerary.' }),
  );
const ItineraryParam = () =>
  ApiParam({ name: 'id', description: 'The itinerary id.' });
const DayParam = () => ApiParam({ name: 'dayId', description: 'The day id.' });

/** Registered first, so /itineraries/public/... is not read as an id. */
@ApiTags('Itineraries')
@Controller('itineraries/public')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: ItineraryPublicService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search public itineraries (ITN-20, ITN-21)',
    description:
      'Public. keyword matches the title, a country or a city (name or ' +
      'code); filter by countryCode, cityId and minDays/maxDays. Newest ' +
      'first, 10 per page.',
  })
  @ApiOkResponse({ type: PublicSearchResultDto })
  @ApiBadRequestResponse({
    description: 'Invalid filter, or minDays > maxDays.',
  })
  search(@Query() query: PublicSearchQueryDto): Promise<PublicSearchResultDto> {
    return this.publicItineraries.search(query);
  }

  @Get(':id')
  @ItineraryParam()
  @ApiOperation({
    summary: 'View a public itinerary (ITN-21)',
    description:
      'Public and read-only: author, days, activities and the budget in ' +
      '`currency` (default EGP).',
  })
  @ApiOkResponse({ type: PublicItineraryViewDto })
  @ApiBadRequestResponse({ description: 'Unsupported currency.' })
  @ApiNotFoundResponse({ description: 'Not found, private or hidden.' })
  view(
    @Param('id') id: string,
    @Query() query: CurrencyQueryDto,
  ): Promise<PublicItineraryViewDto> {
    return this.publicItineraries.view(id, query.currency);
  }
}

@ApiTags('Itineraries')
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly budget: ItineraryBudgetService,
    private readonly publicItineraries: ItineraryPublicService,
  ) {}

  @Post()
  @Owner()
  @ApiOperation({
    summary: 'Create an itinerary (ITN-01)',
    description:
      'Title, one or more countries and a start date. Private by default.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid field or unknown country.' })
  create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateItineraryDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @Owner()
  @ApiOperation({
    summary: 'My itineraries (ITN-03)',
    description:
      'Title, countries, start date, day count and visibility; most ' +
      'recently updated first, 10 per page.',
  })
  @ApiOkResponse({ type: ItineraryListDto })
  list(
    @CurrentUser() user: UserDocument,
    @Query() query: PageQueryDto,
  ): Promise<ItineraryListDto> {
    return this.itineraries.listMine(user, query);
  }

  @Get(':id')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'One of my itineraries (ITN-03, ITN-09)',
    description:
      'Days numbered from 1 with dates from the start date, activities, ' +
      'budget entries, transport costs, and consecutive days in the same ' +
      'city as groups.',
  })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  details(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.details(user, id);
  }

  @Patch(':id')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Edit an itinerary or change its visibility (ITN-01, ITN-20)',
    description:
      'Title, countries, start date (all day dates follow), or visibility ' +
      '(public itineraries appear in search; private removes them at once).',
  })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({
    description: 'Invalid field, or removing a country that days use.',
  })
  @ApiConflictResponse({ description: 'Changed at the same time; reload.' })
  update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateItineraryDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Delete an itinerary (ITN-01)',
    description:
      'Requires confirm:true (GEN-03). It leaves public search; ' +
      'clones made by others are not affected.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  remove(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<void> {
    return this.itineraries.remove(user, id);
  }

  @Post(':id/days')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Add a day (ITN-05)',
    description:
      'Appended as the next day. Needs a seeded city in one of the ' +
      'itinerary countries. At most 60 days.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({
    description: 'Unknown city, wrong country, or 60 days already.',
  })
  addDay(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CreateDayDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.addDay(user, id, dto);
  }

  @Patch(':id/days/reorder')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Move a day to a new position (ITN-08)',
    description: 'Days renumber and their dates and city groups follow.',
  })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'position is past the last day.' })
  reorder(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ReorderDaysDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.reorder(user, id, dto);
  }

  @Patch(':id/days/:dayId')
  @Owner()
  @ItineraryParam()
  @DayParam()
  @ApiOperation({ summary: "Edit a day's city or notes (ITN-05)" })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Nothing to change, or bad city.' })
  updateDay(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: UpdateDayDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.updateDay(user, id, dayId, dto);
  }

  @Delete(':id/days/:dayId')
  @Owner()
  @ItineraryParam()
  @DayParam()
  @ApiOperation({
    summary: 'Delete a day (ITN-07)',
    description:
      'Requires confirm:true (GEN-03). Later days renumber and ' +
      'move one date earlier; budget totals follow.',
  })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  removeDay(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.removeDay(user, id, dayId);
  }

  @Post(':id/days/:dayId/activities')
  @Owner()
  @ItineraryParam()
  @DayParam()
  @ApiOperation({
    summary: 'Add an activity (ITN-10)',
    description: 'Name, description, optional local time and optional cost.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid field or currency.' })
  addActivity(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateActivityDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.addActivity(user, id, dayId, dto);
  }

  @Post(':id/days/:dayId/budgets')
  @Owner()
  @ItineraryParam()
  @DayParam()
  @ApiOperation({
    summary: 'Add a budget entry (ITN-14)',
    description:
      'Food, accommodation, in-city transport or activities; a ' +
      'non-negative amount in a supported currency.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid field or currency.' })
  addBudget(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateBudgetDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.addBudget(user, id, dayId, dto);
  }

  @Post(':id/transport-costs')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Add an intercity transport cost (ITN-16)',
    description: 'Mode, from-city, to-city, amount, currency and day.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({
    description: 'Same or unknown city, or bad currency.',
  })
  addTransport(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CreateTransportCostDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.addTransport(user, id, dto);
  }

  @Get(':id/budget-summary')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Budget totals in one currency (ITN-14, ITN-18)',
    description:
      'By category, day and city group, converted to `currency` or your ' +
      'preferred currency with daily FXRatesAPI rates. Shows the rate ' +
      'date; cached rates are used if the API is down.',
  })
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiBadRequestResponse({ description: 'Unsupported currency.' })
  @ApiServiceUnavailableResponse({
    description: 'No exchange rates at all yet.',
  })
  async budgetSummary(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query() query: CurrencyQueryDto,
  ): Promise<BudgetSummaryDto> {
    const itinerary = await this.itineraries.own(user, id);
    return this.budget.summary(
      itinerary.toObject() as unknown as StoredItinerary,
      query.currency ?? user.preferredCurrency ?? undefined,
    );
  }

  @Post(':id/bookings')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Link a booking to a day (ITN-27, optional)',
    description:
      'One of your confirmed or completed flight or hotel bookings. ' +
      "Without dayId it goes to the day of the flight's departure or the " +
      "hotel's check-in. Flights count as intercity transport and hotels " +
      'as accommodation in the budget, while they stay confirmed.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({
    description: 'No day on the booking date; send dayId.',
  })
  @ApiConflictResponse({ description: 'Not confirmed, or already linked.' })
  linkBooking(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: LinkBookingDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.linkBooking(user, id, dto);
  }

  @Delete(':id/bookings/:linkId')
  @Owner()
  @ItineraryParam()
  @ApiParam({ name: 'linkId', description: 'The link id from the day.' })
  @ApiOperation({ summary: 'Unlink a booking (ITN-27, optional)' })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  unlinkBooking(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.unlinkBooking(user, id, linkId);
  }

  @Get(':id/pdf')
  @Owner()
  @ItineraryParam()
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Download my itinerary as a PDF (ITN-28, optional)',
    description:
      'Days, cities, activities, budget entries, transport and the budget ' +
      'totals in `currency` or your preferred currency (totals are left ' +
      'out if no exchange rates are available).',
  })
  @ApiOkResponse({
    description: 'The itinerary PDF.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({ description: 'Unsupported currency.' })
  async pdf(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query() query: CurrencyQueryDto,
  ): Promise<StreamableFile> {
    const stored = (
      await this.itineraries.own(user, id)
    ).toObject() as unknown as StoredItinerary;
    const details = await this.itineraries.details(user, id);
    let budget: BudgetSummaryDto | undefined;
    try {
      budget = await this.budget.summary(
        stored,
        query.currency ?? user.preferredCurrency ?? undefined,
      );
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
    }
    const safeName =
      details.title.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 60) || 'itinerary';
    return new StreamableFile(buildItineraryPdf(details, budget), {
      type: 'application/pdf',
      disposition: `attachment; filename="${safeName}.pdf"`,
    });
  }

  @Post(':id/clone')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: 'Clone a public itinerary (ITN-21)',
    description:
      'A private, independent copy with all days, activities (and their ' +
      'images) and budgets, crediting the original author.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  clone(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<ItineraryDetailsDto> {
    return this.publicItineraries.clone(user, id);
  }

  @Get(':id/hotels')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: "Hotels for a city group's dates (ITN-25)",
    description:
      "Hotel search (HTL-11) in the group's city: check-in on its first " +
      'day, check-out the day after its last day.',
  })
  @ApiOkResponse({ description: 'The group and the hotel search result.' })
  @ApiBadRequestResponse({ description: 'Unknown group, or past dates.' })
  hotels(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query() query: ItineraryHotelsQueryDto,
  ) {
    return this.publicItineraries.hotels(user, id, query);
  }

  @Get(':id/flights')
  @Owner()
  @ItineraryParam()
  @ApiOperation({
    summary: "Flights to the first day's city (ITN-26)",
    description:
      'Flight search (FLT-11, FLT-12) from the origin to each airport in ' +
      'the city of day 1. Departure defaults to the start date; round ' +
      "trips return on the last day's date by default.",
  })
  @ApiOkResponse({ description: 'Results per destination airport.' })
  @ApiBadRequestResponse({ description: 'No days, or invalid search.' })
  flights(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query() query: ItineraryFlightsQueryDto,
  ) {
    return this.publicItineraries.flights(user, id, query);
  }
}

/** Activities, budget entries and transport costs by their own ids. */
@ApiTags('Itineraries')
@Controller()
export class ItineraryItemsController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Patch('activities/:id')
  @Owner()
  @ApiParam({ name: 'id', description: 'The activity id.' })
  @ApiOperation({ summary: 'Edit an activity (ITN-10)' })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Nothing to change, or invalid.' })
  updateActivity(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.updateActivity(user, id, dto);
  }

  @Delete('activities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Owner()
  @ApiParam({ name: 'id', description: 'The activity id.' })
  @ApiOperation({ summary: 'Delete an activity and its images (ITN-10)' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  removeActivity(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<void> {
    return this.itineraries.removeActivity(user, id);
  }

  @Post('activities/:id/images')
  @Owner()
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiParam({ name: 'id', description: 'The activity id.' })
  @ApiOperation({
    summary: 'Add an image to an activity (ITN-12, GEN-08)',
    description: 'JPG or PNG, up to 5 MB, at most 5 per activity.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({
    description: 'Not a JPG or PNG, no file, or 5 images already.',
  })
  @ApiPayloadTooLargeResponse({ description: 'Larger than 5 MB.' })
  addImage(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.addImage(user, id, file);
  }

  @Delete('activities/:id/images/:imageId')
  @Owner()
  @ApiParam({ name: 'id', description: 'The activity id.' })
  @ApiParam({ name: 'imageId', description: 'The image id.' })
  @ApiOperation({ summary: 'Remove an image from an activity (ITN-12)' })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  removeImage(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.removeImage(user, id, imageId);
  }

  @Patch('budgets/:id')
  @Owner()
  @ApiParam({ name: 'id', description: 'The budget entry id.' })
  @ApiOperation({ summary: 'Edit a budget entry (ITN-14)' })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Nothing to change, or invalid.' })
  updateBudget(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.updateBudget(user, id, dto);
  }

  @Delete('budgets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Owner()
  @ApiParam({ name: 'id', description: 'The budget entry id.' })
  @ApiOperation({ summary: 'Delete a budget entry (ITN-14)' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  removeBudget(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<void> {
    return this.itineraries.removeBudget(user, id);
  }

  @Patch('transport-costs/:id')
  @Owner()
  @ApiParam({ name: 'id', description: 'The transport cost id.' })
  @ApiOperation({
    summary: 'Edit a transport cost (ITN-16)',
    description: 'Any field, including dayId to move it to another day.',
  })
  @ApiOkResponse({ type: ItineraryDetailsDto })
  @ApiBadRequestResponse({ description: 'Nothing to change, or invalid.' })
  updateTransport(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateTransportCostDto,
  ): Promise<ItineraryDetailsDto> {
    return this.itineraries.updateTransport(user, id, dto);
  }

  @Delete('transport-costs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Owner()
  @ApiParam({ name: 'id', description: 'The transport cost id.' })
  @ApiOperation({ summary: 'Delete a transport cost (ITN-16)' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  removeTransport(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<void> {
    return this.itineraries.removeTransport(user, id);
  }
}
