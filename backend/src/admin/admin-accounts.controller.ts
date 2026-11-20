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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiCookieAuth,
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
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import { AdminAccountsService } from './admin-accounts.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import {
  AccountListResponseDto,
  ListAccountsQueryDto,
} from './dto/list-accounts.dto';
import { AdminResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Admin')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({
  description: 'Not an administrator, or the target is an administrator.',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminAccountsController {
  constructor(private readonly adminAccounts: AdminAccountsService) {}

  @Post('moderators')
  @ApiOperation({
    summary: 'Create an airline or hotel moderator (ACC-13)',
    description:
      'Links the new account to exactly one existing airline or hotel. ' +
      'The admin sets a temporary password; the moderator must change it ' +
      'on first login before using anything else.',
  })
  @ApiCreatedResponse({
    type: UserResponseDto,
    description: 'Moderator created; mustChangePassword is true.',
  })
  @ApiBadRequestResponse({
    description:
      'A field is missing or invalid, or the role is not a moderator role.',
  })
  @ApiNotFoundResponse({ description: 'The airline or hotel does not exist.' })
  @ApiConflictResponse({ description: 'The email is already registered.' })
  async createModerator(
    @Body() dto: CreateModeratorDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromUser(
      await this.adminAccounts.createModerator(dto),
    );
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'List all accounts (ACC-14)',
    description:
      'Name, email, role, status and registration date, newest first, ' +
      '10 per page. Search by part of the name or email and filter by ' +
      'role and status.',
  })
  @ApiOkResponse({ type: AccountListResponseDto })
  @ApiBadRequestResponse({ description: 'An invalid page, role or status.' })
  listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<AccountListResponseDto> {
    return this.adminAccounts.listAccounts(query);
  }

  @Patch('accounts/:id/suspend')
  @ApiParam({ name: 'id', description: 'The account id.' })
  @ApiNotFoundResponse({ description: 'Account not found.' })
  @ApiOperation({
    summary: 'Suspend a user or moderator (ACC-15, ACC-16)',
    description:
      'The account can no longer log in and its open sessions end at ' +
      'once. Existing bookings remain valid. The owner gets an in-app ' +
      'notification and the action is audited.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'The account is not active.' })
  async suspend(
    @CurrentUser() admin: UserDocument,
    @Param('id') id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromUser(
      await this.adminAccounts.suspend(admin._id, id),
    );
  }

  @Patch('accounts/:id/reactivate')
  @ApiParam({ name: 'id', description: 'The account id.' })
  @ApiNotFoundResponse({ description: 'Account not found.' })
  @ApiOperation({
    summary: 'Reactivate a suspended user or moderator (ACC-15, ACC-16)',
    description:
      'The account can log in again. The owner gets an in-app ' +
      'notification and the action is audited.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'The account is not suspended.' })
  async reactivate(
    @CurrentUser() admin: UserDocument,
    @Param('id') id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromUser(
      await this.adminAccounts.reactivate(admin._id, id),
    );
  }

  @Post('users/:id/reset-password')
  @ApiParam({ name: 'id', description: 'The account id.' })
  @ApiNotFoundResponse({ description: 'Account not found.' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset a password to a temporary one (ACC-07a)',
    description:
      'Sets a temporary password chosen by the admin. At the next login ' +
      'the account must change it before using anything else. Open ' +
      'sessions end and any login lockout is cleared. The action is ' +
      'audited.',
  })
  @ApiOkResponse({
    type: UserResponseDto,
    description: 'Password reset; mustChangePassword is true.',
  })
  @ApiBadRequestResponse({
    description: 'The temporary password breaks the password rules.',
  })
  async resetPassword(
    @CurrentUser() admin: UserDocument,
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromUser(
      await this.adminAccounts.resetPassword(
        admin._id,
        id,
        dto.temporaryPassword,
      ),
    );
  }
}
