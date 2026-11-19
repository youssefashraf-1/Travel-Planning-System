import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_DESCRIPTION,
} from '../../auth/dto/password-rules';
import { UserRole } from '../../users/schemas/user.schema';

export const MODERATOR_ROLES = [
  UserRole.AIRLINE_MODERATOR,
  UserRole.HOTEL_MODERATOR,
] as const;
export type ModeratorRole = (typeof MODERATOR_ROLES)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ACC-13: an admin creates a moderator linked to exactly one airline or
 * hotel, with a temporary password the moderator must change on first login.
 */
export class CreateModeratorDto {
  @ApiProperty({ example: 'Omar Fathy', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'omar.fathy@egyptair.example' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: MODERATOR_ROLES, example: UserRole.AIRLINE_MODERATOR })
  @IsIn(MODERATOR_ROLES, {
    message: `role must be one of: ${MODERATOR_ROLES.join(', ')}`,
  })
  role: ModeratorRole;

  @ApiProperty({
    example: '6740f0c2a1b2c3d4e5f60718',
    description:
      'The airline id for an airline moderator, or the hotel id for a ' +
      'hotel moderator.',
  })
  @IsMongoId()
  providerId: string;

  @ApiProperty({
    example: 'Temp2026pass',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: `${PASSWORD_RULES_DESCRIPTION} The moderator must change it on first login.`,
  })
  @IsValidPassword('temporaryPassword')
  temporaryPassword: string;
}
