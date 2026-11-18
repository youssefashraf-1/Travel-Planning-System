import { Injectable } from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { PasswordHasherService } from './password-hasher.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  /**
   * ACC-01: creates a traveler account. Validation has already run on the
   * DTO; this hashes the password, records consent time and saves the user.
   * A duplicate email surfaces as 409 Conflict from UsersService.
   */
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const passwordHash = await this.passwordHasher.hash(dto.password);
    const user = await this.usersService.createTraveler({
      name: dto.name,
      email: dto.email,
      passwordHash,
      termsAndPrivacyAcceptedAt: new Date(),
    });
    return UserResponseDto.fromUser(user);
  }
}
