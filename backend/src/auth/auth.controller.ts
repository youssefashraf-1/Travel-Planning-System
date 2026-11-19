import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UserResponseDto } from '../users/dto/user-response.dto';
import type { UserDocument } from '../users/schemas/user.schema';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_EXPIRED_MESSAGE,
} from './auth.constants';
import { clearAuthCookies, readCookie, setAuthCookies } from './auth-cookies';
import { AuthService } from './auth.service';
import { AllowPendingPasswordChange } from './decorators/allow-pending-password-change.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { AuthenticatedRequest } from './guards/jwt-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a traveler account (ACC-01)',
    description:
      'Creates a traveler account from a name, email, password and ' +
      'terms/privacy consent. The role is always traveler. The response ' +
      'never contains the password or its hash. Registering does not sign ' +
      'the user in.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid email, weak password, missing consent, or unknown fields ' +
      'such as role.',
  })
  @ApiConflictResponse({
    description: 'An account with this email already exists.',
  })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in (ACC-04, ACC-05)',
    description:
      'Checks the email and password and starts a session. Two HttpOnly ' +
      `cookies are set: "${ACCESS_TOKEN_COOKIE}" (a JWT valid for 15 ` +
      `minutes) and "${REFRESH_TOKEN_COOKIE}" (used by /api/auth/refresh). ` +
      'Tokens are never returned in the body. Five consecutive wrong ' +
      'passwords lock the account for 15 minutes; a successful login ' +
      'resets the counter.',
  })
  @ApiOkResponse({
    type: UserResponseDto,
    description: 'Logged in. Both cookies are set.',
  })
  @ApiBadRequestResponse({ description: 'Missing or invalid fields.' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.' })
  @ApiForbiddenResponse({
    description: 'The account is suspended or deactivated.',
  })
  @ApiResponse({
    status: HttpStatus.LOCKED,
    description: 'Too many failed attempts; the account is locked.',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const result = await this.authService.login(dto);
    setAuthCookies(response, result);
    return result.user;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Renew the session (ACC-19)',
    description:
      'Uses the refresh_token cookie to issue new access and refresh ' +
      'cookies while the session is open. A session closes after 30 ' +
      'minutes without an authenticated request, or at logout. Each ' +
      'refresh token works only once.',
  })
  @ApiOkResponse({ type: UserResponseDto, description: 'Cookies renewed.' })
  @ApiUnauthorizedResponse({
    description: 'No session, or it expired or was logged out.',
  })
  @ApiForbiddenResponse({
    description: 'The account is suspended or deactivated.',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponseDto> {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }
    const result = await this.authService.refresh(refreshToken);
    setAuthCookies(response, result);
    return result.user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Log out (ACC-06)',
    description:
      'Revokes the session on the server, then clears both cookies. Old ' +
      'access and refresh tokens stop working immediately. Calling it ' +
      'without a session is harmless.',
  })
  @ApiNoContentResponse({ description: 'Logged out; cookies cleared.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout({
      accessToken: readCookie(request, ACCESS_TOKEN_COOKIE),
      refreshToken: readCookie(request, REFRESH_TOKEN_COOKIE),
    });
    clearAuthCookies(response);
  }
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowPendingPasswordChange()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Get the signed-in account (ACC-04, ACC-19)',
    description:
      'The frontend calls this to learn who is logged in, using only the ' +
      'HttpOnly cookies. It also counts as activity for the 30-minute ' +
      'session. When mustChangePassword is true, the frontend should send ' +
      'the user to change their password; other routes return 403 until then.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the session has expired.',
  })
  @ApiForbiddenResponse({ description: 'The account is suspended.' })
  me(@CurrentUser() user: UserDocument): UserResponseDto {
    return UserResponseDto.fromUser(user);
  }
  @Patch('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @AllowPendingPasswordChange()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Change my password (ACC-08)',
    description:
      'Requires the current password and a new one with at least eight ' +
      'characters, one letter and one digit, different from the current ' +
      'one. Other browsers are logged out; this one stays signed in. This ' +
      'also completes a required change after an admin reset (ACC-07a).',
  })
  @ApiNoContentResponse({ description: 'Password changed.' })
  @ApiBadRequestResponse({
    description:
      'Current password is wrong, the new password breaks the rules, or ' +
      'it equals the current one.',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(
      request.user._id,
      request.sessionId,
      dto,
    );
  }
}
