import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  LOGIN_LOCKOUT_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordHasherService } from './password-hasher.service';
import { TokenService } from './token.service';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

export interface LoginResult {
  user: UserResponseDto;
  accessToken: string;
}

@Injectable()
export class AuthService {
  /** Used to spend the same hashing time when an email is unknown. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
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

  /**
   * ACC-04, ACC-05: checks the email and password and issues an access token.
   * - Unknown email and wrong password give the same 401 message.
   * - Five consecutive wrong passwords lock the account for 15 minutes (423).
   * - Suspended and deactivated accounts cannot log in (403).
   * - A successful login resets the failure counter.
   */
  async login(dto: LoginDto, now = new Date()): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(dto.email, {
      includePasswordHash: true,
    });

    if (!user) {
      await this.passwordHasher.verify(dto.password, await this.getDummyHash());
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      throw lockedException(user.lockedUntil, now);
    }

    const passwordMatches = await this.passwordHasher.verify(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      const { lockedUntil } = await this.usersService.recordFailedLogin(
        user._id,
        now,
        MAX_FAILED_LOGIN_ATTEMPTS,
        LOGIN_LOCKOUT_MINUTES,
      );
      if (lockedUntil) {
        throw lockedException(lockedUntil, now);
      }
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Status is checked only after the password, so it is not revealed to
    // someone who merely knows the email.
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`This account is ${user.status}.`);
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.usersService.resetFailedLogins(user._id);
    }

    const accessToken = await this.tokenService.signAccessToken(user);
    return { user: UserResponseDto.fromUser(user), accessToken };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwordHasher.hash('unused-dummy-password-1');
    return this.dummyHash;
  }
}

function lockedException(lockedUntil: Date, now: Date): HttpException {
  const minutes = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000),
  );
  return new HttpException(
    `Too many failed login attempts. Try again in ${minutes} minute(s).`,
    HttpStatus.LOCKED,
  );
}
