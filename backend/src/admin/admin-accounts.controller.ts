import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Admin')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({
  description: 'Not an administrator, or the target is an administrator.',
})
@ApiNotFoundResponse({ description: 'Account not found.' })
@ApiParam({ name: 'id', description: 'The account id.' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminAccountsController {
  constructor(private readonly adminAccounts: AdminAccountsService) {}

  @Patch('accounts/:id/suspend')
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
