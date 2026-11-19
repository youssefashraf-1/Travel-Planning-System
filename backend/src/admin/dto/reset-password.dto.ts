import { ApiProperty } from '@nestjs/swagger';
import {
  IsValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_DESCRIPTION,
} from '../../auth/dto/password-rules';

/** ACC-07a: the temporary password an admin gives to a user or moderator. */
export class AdminResetPasswordDto {
  @ApiProperty({
    example: 'Temp2026pass',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description:
      `${PASSWORD_RULES_DESCRIPTION} Share it with the user privately; ` +
      'they must replace it at their next login.',
  })
  @IsValidPassword('temporaryPassword')
  temporaryPassword: string;
}
