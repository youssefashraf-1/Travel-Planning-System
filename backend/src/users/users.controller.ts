import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { clearAuthCookies } from '../auth/auth-cookies';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountDeactivationService } from './account-deactivation.service';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { UserDocument } from './schemas/user.schema';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in or session expired.' })
@ApiForbiddenResponse({ description: 'The account is suspended.' })
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeactivation: AccountDeactivationService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'View my profile (ACC-11)',
    description:
      'Returns the signed-in user’s own profile. Users can only read ' +
      'their own profile through this endpoint.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  getMyProfile(@CurrentUser() user: UserDocument): ProfileResponseDto {
    return ProfileResponseDto.fromUser(user);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit my profile (ACC-09)',
    description:
      'Changes name, phone and/or preferred currency. Send only the ' +
      'fields to change; null removes phone or currency. Nothing is saved ' +
      'unless every field is valid. Email, role and status cannot be ' +
      'changed here.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({
    description:
      'A field is invalid, the currency is not supported, no field was ' +
      'sent, or an unknown field such as role or email was sent.',
  })
  async updateMyProfile(
    @CurrentUser() user: UserDocument,
    @Body() changes: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const updated = await this.usersService.updateProfile(user._id, changes);
    return ProfileResponseDto.fromUser(updated);
  }
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Deactivate my account (ACC-12)',
    description:
      'Requires confirm: true and the current password. Blocked while the ' +
      'user has upcoming confirmed bookings. The account cannot log in ' +
      'afterwards; all its sessions end and the cookies are cleared.',
  })
  @ApiNoContentResponse({ description: 'Account deactivated.' })
  @ApiBadRequestResponse({
    description: 'Missing confirmation or wrong current password.',
  })
  @ApiConflictResponse({
    description: 'The user has upcoming confirmed bookings.',
  })
  async deactivateMyAccount(
    @CurrentUser() user: UserDocument,
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.accountDeactivation.deactivateOwnAccount(user._id, dto);
    clearAuthCookies(response);
  }
}
