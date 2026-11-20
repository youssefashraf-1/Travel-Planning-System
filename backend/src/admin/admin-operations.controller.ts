import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProviderType } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import { AdminAuditService } from './admin-audit.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminProvidersService } from './admin-providers.service';
import {
  AdminAuditListDto,
  AdminAuditQueryDto,
  AdminBookingListDto,
  AdminBookingsQueryDto,
  AdminProviderDto,
  AdminProviderListDto,
  ConfirmProviderActionDto,
  ProviderListQueryDto,
} from './dto/admin-operations.dto';

@ApiTags('Admin operations')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiUnauthorizedResponse({ description: 'Log in first.' })
@ApiForbiddenResponse({ description: 'Administrators only.' })
@ApiBadRequestResponse({
  description: 'Invalid input, pagination, dates or missing confirmation.',
})
@Controller('admin')
export class AdminOperationsController {
  constructor(
    private readonly providers: AdminProvidersService,
    private readonly bookings: AdminBookingsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('providers/:type')
  @ApiParam({ name: 'type', enum: ProviderType })
  @ApiOperation({
    summary: 'List active/inactive airlines or hotels (ACC-15)',
    description:
      'Ten per page; name search and optional isActive=true/false filter.',
  })
  @ApiOkResponse({ type: AdminProviderListDto })
  listProviders(
    @Param('type', new ParseEnumPipe(ProviderType)) type: ProviderType,
    @Query() query: ProviderListQueryDto,
  ) {
    return this.providers.list(type, query);
  }

  @Patch('providers/:type/:id/deactivate')
  @ApiParam({ name: 'type', enum: ProviderType })
  @ApiOperation({
    summary: 'Deactivate a provider (ACC-15)',
    description:
      'Requires confirm:true. Stops new bookings and ends pending payment holds. Confirmed bookings stay valid; moderators and affected booking owners are notified. Status, audit, holds and notifications are atomic.',
  })
  @ApiOkResponse({ type: AdminProviderDto })
  @ApiNotFoundResponse({ description: 'Provider not found.' })
  @ApiConflictResponse({
    description: 'Already inactive or concurrently changed.',
  })
  deactivate(
    @CurrentUser() admin: UserDocument,
    @Param('type', new ParseEnumPipe(ProviderType)) type: ProviderType,
    @Param('id') id: string,
    @Body() _dto: ConfirmProviderActionDto,
  ) {
    return this.providers.setActive(admin, type, id, false);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiParam({ name: 'type', enum: ProviderType })
  @ApiOperation({
    summary: 'Reactivate a provider (ACC-15)',
    description:
      'Requires confirm:true. Allows new bookings again. Does not restore expired holds or change moderator account status.',
  })
  @ApiOkResponse({ type: AdminProviderDto })
  @ApiNotFoundResponse({ description: 'Provider not found.' })
  @ApiConflictResponse({
    description: 'Already active or concurrently changed.',
  })
  reactivate(
    @CurrentUser() admin: UserDocument,
    @Param('type', new ParseEnumPipe(ProviderType)) type: ProviderType,
    @Param('id') id: string,
    @Body() _dto: ConfirmProviderActionDto,
  ) {
    return this.providers.setActive(admin, type, id, true);
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'Read all flight and hotel bookings (ACC-17)',
    description:
      'Read-only, ten per page, newest creation first. Filter by type, status and inclusive travel start-date range: outbound departure airport-local date for flights; check-in date for hotels. Returns reference, user, providers, dates, amount and status; no passport numbers or payment secrets.',
  })
  @ApiOkResponse({ type: AdminBookingListDto })
  listBookings(@Query() query: AdminBookingsQueryDto) {
    return this.bookings.list(query);
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Read administrator audit history (GEN-07)',
    description:
      'Read-only, ten per page, newest first. Filter by action, actorId, targetModel, targetId and inclusive UTC calendar date range. There are no audit-edit/delete endpoints.',
  })
  @ApiOkResponse({ type: AdminAuditListDto })
  listAudit(@Query() query: AdminAuditQueryDto) {
    return this.audit.list(query);
  }
}
