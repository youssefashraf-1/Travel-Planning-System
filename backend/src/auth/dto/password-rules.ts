import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
// Long enough for passphrases, short enough to bound hashing work.
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES_DESCRIPTION =
  'At least eight characters with at least one letter and one digit.';

/**
 * ACC-01 password rules, shared by registration, password change and admin
 * password reset: 8 to 128 characters with at least one letter and one digit.
 */
export function IsValidPassword(field = 'password'): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(/[A-Za-z]/, {
      message: `${field} must contain at least one letter`,
    }),
    Matches(/\d/, { message: `${field} must contain at least one digit` }),
  );
}
