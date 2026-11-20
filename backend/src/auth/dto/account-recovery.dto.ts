import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_DESCRIPTION,
} from './password-rules';

/** ACC-07: ask for a password reset link. */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'mona.hassan@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;
}

/** ACC-07: set a new password with the token from the emailed link. */
export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the reset link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @ApiProperty({
    example: 'journey2027',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: PASSWORD_RULES_DESCRIPTION,
  })
  @IsValidPassword('newPassword')
  newPassword: string;
}

/** ACC-02: the token from the verification link. */
export class VerifyEmailQueryDto {
  @ApiProperty({ description: 'The token from the verification link.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}
