import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
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
}
