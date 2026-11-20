import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsDto, AnalyticsQueryDto } from './dto/admin-analytics.dto';

@ApiTags('Admin')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('analytics')
  @ApiOperation({
    summary: 'Bookings and revenue per provider (BON-01, optional)',
    description:
      'Bookings paid between fromDate and toDate (UTC, inclusive; default ' +
      'the last 30 days, at most 366), per airline and hotel: bookings, ' +
      'later cancellations, gross revenue, refunds and net revenue in EGP ' +
      'minor units. A round trip on two airlines is split by segment.',
  })
  @ApiOkResponse({ type: AnalyticsDto })
  @ApiBadRequestResponse({ description: 'Invalid dates or range.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  @ApiForbiddenResponse({ description: 'Not an administrator.' })
  report(@Query() query: AnalyticsQueryDto): Promise<AnalyticsDto> {
    return this.analytics.report(query);
  }
}
