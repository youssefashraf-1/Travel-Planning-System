import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const PASSWORD_MIN_LENGTH = 8;
// Long enough for passphrases, short enough to bound hashing work.
export const PASSWORD_MAX_LENGTH = 128;

/** Self-registration request for a traveler account (ACC-01). */
export class RegisterDto {
  @ApiProperty({ example: 'Mona Hassan', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'mona.hassan@example.com',
    description: 'Stored trimmed and lowercased; must be unique.',
  })
  @Transform(trimAndLowercase)
  @IsString()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'travel2026',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description:
      'At least eight characters with at least one letter and one digit.',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(/[A-Za-z]/, { message: 'password must contain at least one letter' })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password: string;

  @ApiProperty({
    example: true,
    description: 'Must be true: the user accepts the terms and privacy policy.',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'acceptTermsAndPrivacy must be accepted to register',
  })
  acceptTermsAndPrivacy: boolean;
}
