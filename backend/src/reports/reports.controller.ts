import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
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
  ApiNoContentResponse,
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
import { DeleteBlogPostDto } from '../blog/dto/blog-post-requests.dto';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  ContentType,
  CreateReportDto,
  ModeratedContentDto,
  ReportDto,
  ReportListDto,
  ReportResolution,
  ReportsQueryDto,
  ResolveReportDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Content reports')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ description: 'Log in first.' })
@ApiNotFoundResponse({ description: 'Content not accessible.' })
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('reports')
  @ApiOperation({
    summary: 'Report visible content once (GEN-09)',
    description:
      'A registered user can report a public post, comment, review or itinerary with a nonblank reason. The same user cannot report that item twice, even after resolution.',
  })
  @ApiCreatedResponse({ type: ReportDto })
  @ApiBadRequestResponse({ description: 'Invalid content type, id or reason.' })
  @ApiConflictResponse({ description: 'Already reported this item.' })
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }

  @Get('content/mine/:type/:id')
  @ApiParam({ name: 'type', enum: ContentType })
  @ApiOperation({
    summary: 'Read my content, including hidden items (GEN-10)',
    description:
      'Owner only; does not expose hidden items to other users. Admin inspection uses the admin endpoint.',
  })
  @ApiOkResponse({ type: ModeratedContentDto })
  readOwn(
    @CurrentUser() user: UserDocument,
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id') id: string,
  ) {
    return this.reports.read(type, id, user);
  }
}

@ApiTags('Content moderation')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiUnauthorizedResponse({ description: 'Log in first.' })
@ApiForbiddenResponse({ description: 'Administrators only.' })
@ApiNotFoundResponse({ description: 'Report/content not found.' })
@ApiBadRequestResponse({
  description: 'Invalid input or missing confirmation.',
})
@ApiConflictResponse({
  description: 'Report already resolved or content changed.',
})
@Controller('admin')
export class ContentModerationController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'List reports (GEN-10)',
    description:
      'Open by default; optional status filter. Ten per page, newest first.',
  })
  @ApiOkResponse({ type: ReportListDto })
  list(@Query() query: ReportsQueryDto) {
    return this.reports.list(query);
  }

  @Post('reports/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resolve a report (GEN-10, GEN-07)',
    description:
      'Dismiss, hide or delete; requires confirm:true. Content changes, resolution of related open reports and the audit entry are atomic. If the author already deleted it, dismiss the report.',
  })
  @ApiOkResponse({ type: ReportDto })
  resolve(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(user, id, dto.action);
  }

  @Get('content/:type/:id')
  @ApiParam({ name: 'type', enum: ContentType })
  @ApiOperation({ summary: 'Inspect content, including hidden items (GEN-10)' })
  @ApiOkResponse({ type: ModeratedContentDto })
  read(
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id') id: string,
  ) {
    return this.reports.read(type, id);
  }

  @Patch('content/:type/:id/hide')
  @ApiParam({ name: 'type', enum: ContentType })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Hide content directly (GEN-10)',
    description:
      'Requires confirm:true. Hidden content is accessible only through author/admin views. Records an audit entry.',
  })
  @ApiNoContentResponse()
  hide(
    @CurrentUser() user: UserDocument,
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id') id: string,
    @Body() _dto: DeleteBlogPostDto,
  ) {
    return this.reports.moderate(user, type, id, ReportResolution.HIDE);
  }

  @Delete('content/:type/:id')
  @ApiParam({ name: 'type', enum: ContentType })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete content directly (GEN-10, GEN-03)',
    description:
      'Requires confirm:true. Removes dependent post comments/likes and owned images; resolves related open reports and records an audit entry.',
  })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: UserDocument,
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Param('id') id: string,
    @Body() _dto: DeleteBlogPostDto,
  ) {
    return this.reports.moderate(user, type, id, ReportResolution.DELETE);
  }
}
