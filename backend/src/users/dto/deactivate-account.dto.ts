import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/dto/password-rules';

/**
 * ACC-12, GEN-03: deactivating needs explicit confirmation and the current
 * password, so it cannot happen by accident or from a stolen session alone.
 */
export class DeactivateAccountDto {
  @ApiProperty({ example: 'travel2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    example: true,
    description: 'Must be true to confirm the deactivation.',
  })
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true to deactivate the account' })
  confirm: boolean;
}
