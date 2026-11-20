import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_DESCRIPTION,
} from './password-rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

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
    description: PASSWORD_RULES_DESCRIPTION,
  })
  @IsValidPassword()
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
