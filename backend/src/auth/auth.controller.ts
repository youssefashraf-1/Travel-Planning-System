import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserResponseDto } from '../users/dto/user-response.dto';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
} from './auth.constants';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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
      'Checks the email and password. On success the signed access token ' +
      `(JWT) is set in the HttpOnly "${ACCESS_TOKEN_COOKIE}" cookie and is ` +
      'never returned in the body. Five consecutive wrong passwords lock ' +
      'the account for 15 minutes; a successful login resets the counter.',
  })
  @ApiOkResponse({
    type: UserResponseDto,
    description: `Logged in. The ${ACCESS_TOKEN_COOKIE} cookie is set.`,
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
    const { user, accessToken } = await this.authService.login(dto);
    response.cookie(
      ACCESS_TOKEN_COOKIE,
      accessToken,
      accessTokenCookieOptions(),
    );
    return user;
  }
}
