import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UserStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  LOGIN_LOCKOUT_MINUTES,
  MAX_FAILED_LOGIN_ATTEMPTS,
  SESSION_EXPIRED_MESSAGE,
} from './auth.constants';
import { MailService } from '../common/mail/mail.service';
import { AccountTokensService } from './account-tokens.service';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/account-recovery.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AccountTokenPurpose } from './schemas/account-token.schema';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordHasherService } from './password-hasher.service';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

/** A signed-in user with the two tokens the controller puts in cookies. */
export interface AuthResult {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
}

/** The cookies a browser sent; either may be missing. */
export interface SessionCookies {
  accessToken?: string;
  refreshToken?: string;
}

@Injectable()
export class AuthService {
  /** Used to spend the same hashing time when an email is unknown. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: TokenService,
    private readonly sessionsService: SessionsService,
    private readonly accountTokens: AccountTokensService,
    private readonly mail: MailService,
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
    await this.sendVerification(user._id, user.name, user.email);
    return UserResponseDto.fromUser(user);
  }

  /** ACC-02: follows the emailed link. Each link works once, for 24 hours. */
  async verifyEmail(token: string, now = new Date()): Promise<void> {
    const userId = await this.accountTokens.consume(
      token,
      AccountTokenPurpose.EMAIL_VERIFICATION,
      now,
    );
    if (!userId)
      throw new BadRequestException(
        'This verification link is invalid or has expired. Request a new one after logging in.',
      );
    await this.usersService.markEmailVerified(userId);
  }

  /** ACC-02: sends a new verification link; earlier links stop working. */
  async resendVerification(userId: Types.ObjectId): Promise<void> {
    const user = await this.usersService.findById(userId.toString());
    if (!user) throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    if (user.emailVerified !== false)
      throw new ConflictException('This email address is already verified.');
    await this.sendVerification(user._id, user.name, user.email);
  }

  /**
   * ACC-07: emails a reset link valid for 30 minutes. A newer request
   * invalidates older links. The response is the same whether or not the
   * email belongs to an account, so it cannot be used to find accounts.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    now = new Date(),
  ): Promise<void> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const token = await this.accountTokens.issue(
      user._id,
      AccountTokenPurpose.PASSWORD_RESET,
      30,
      now,
    );
    // Not awaited: the reply time must not reveal whether an email was sent.
    void this.mail.send({
      to: user.email,
      subject: 'Reset your Travel Planning password',
      text:
        `Hello ${user.name},\n\nSomeone asked to reset the password for this account. ` +
        `Open this link within 30 minutes to choose a new one:\n\n` +
        `${this.mail.frontendUrl()}/reset-password?token=${token}\n\n` +
        `The link works once. If you did not ask for this, ignore this email.`,
    });
  }

  /**
   * ACC-07: sets the new password with a valid, unused link token. The
   * account's sessions end, any lockout clears, and the link stops working.
   */
  async resetPassword(dto: ResetPasswordDto, now = new Date()): Promise<void> {
    const userId = await this.accountTokens.consume(
      dto.token,
      AccountTokenPurpose.PASSWORD_RESET,
      now,
    );
    if (!userId)
      throw new BadRequestException(
        'This reset link is invalid, already used or expired. Request a new one.',
      );
    const passwordHash = await this.passwordHasher.hash(dto.newPassword);
    await this.usersService.setPassword(userId, passwordHash, false);
    await this.sessionsService.revokeAllForUser(userId, now);
  }

  private async sendVerification(
    userId: Types.ObjectId,
    name: string,
    email: string,
  ): Promise<void> {
    const token = await this.accountTokens.issue(
      userId,
      AccountTokenPurpose.EMAIL_VERIFICATION,
      24 * 60,
    );
    await this.mail.send({
      to: email,
      subject: 'Verify your Travel Planning email address',
      text:
        `Hello ${name},\n\nWelcome! Confirm your email address to start booking ` +
        `flights and hotels:\n\n` +
        `${this.mail.apiUrl()}/api/auth/verify-email?token=${token}\n\n` +
        `The link is valid for 24 hours.`,
    });
  }

  /**
   * ACC-04, ACC-05: checks the email and password and issues an access token.
   * - Unknown email and wrong password give the same 401 message.
   * - Five consecutive wrong passwords lock the account for 15 minutes (423).
   * - Suspended and deactivated accounts cannot log in (403).
   * - A successful login resets the failure counter.
   */
  async login(dto: LoginDto, now = new Date()): Promise<AuthResult> {
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

    const { session, refreshToken } = await this.sessionsService.create(
      user._id,
      now,
    );
    const accessToken = await this.tokenService.signAccessToken(
      user,
      session._id,
    );
    return { user: UserResponseDto.fromUser(user), accessToken, refreshToken };
  }

  /**
   * ACC-19: issues a new access token and a new refresh token while the
   * session is still open (used within 30 minutes and not logged out).
   * The old refresh token stops working.
   */
  async refresh(refreshToken: string, now = new Date()): Promise<AuthResult> {
    const renewed = await this.sessionsService.rotate(refreshToken, now);
    if (!renewed) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const user = await this.usersService.findById(
      renewed.session.userId.toString(),
    );
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessionsService.revokeById(renewed.session.id, now);
      throw user
        ? new ForbiddenException(`This account is ${user.status}.`)
        : new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const accessToken = await this.tokenService.signAccessToken(
      user,
      renewed.session._id,
    );
    return {
      user: UserResponseDto.fromUser(user),
      accessToken,
      refreshToken: renewed.refreshToken,
    };
  }

  /**
   * ACC-06: revokes the browser's session on the server. The controller
   * clears the cookies afterwards. Logging out twice is harmless.
   */
  async logout(cookies: SessionCookies, now = new Date()): Promise<void> {
    if (cookies.refreshToken) {
      await this.sessionsService.revokeByRefreshToken(
        cookies.refreshToken,
        now,
      );
    }
    if (cookies.accessToken) {
      try {
        const { sid } = await this.tokenService.verifyAccessToken(
          cookies.accessToken,
        );
        await this.sessionsService.revokeById(sid, now);
      } catch {
        // An invalid or expired access token has nothing left to revoke.
      }
    }
  }

  /**
   * ACC-08: changes the password after checking the current one. The new
   * password must follow the rules and differ from the current one. Other
   * browsers are logged out; this one stays signed in. It also completes a
   * required change after an admin reset (ACC-07a).
   */
  async changePassword(
    userId: Types.ObjectId,
    currentSessionId: string,
    dto: ChangePasswordDto,
    now = new Date(),
  ): Promise<void> {
    const user = await this.usersService.findById(userId.toString(), {
      includePasswordHash: true,
    });
    if (!user) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const currentMatches = await this.passwordHasher.verify(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentMatches) {
      throw new BadRequestException('The current password is incorrect.');
    }
    if (await this.passwordHasher.verify(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException(
        'The new password must be different from the current password.',
      );
    }

    const passwordHash = await this.passwordHasher.hash(dto.newPassword);
    await this.usersService.setPassword(user._id, passwordHash, false);
    await this.sessionsService.revokeAllForUser(
      user._id,
      now,
      currentSessionId,
    );
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
