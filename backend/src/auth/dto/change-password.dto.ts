import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_DESCRIPTION,
} from './password-rules';

/** ACC-08: change the password by giving the current one and a new one. */
export class ChangePasswordDto {
  @ApiProperty({ example: 'travel2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    example: 'journey2027',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: `${PASSWORD_RULES_DESCRIPTION} Must differ from the current password.`,
  })
  @IsValidPassword('newPassword')
  newPassword: string;
}
