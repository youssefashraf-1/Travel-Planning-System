import { ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../schemas/user.schema';
import { UserResponseDto } from './user-response.dto';

type ProfileRecord = Parameters<typeof UserResponseDto.fromUser>[0] &
  Pick<User, 'phone' | 'preferredCurrency'>;

/** The signed-in user's own profile (ACC-09, ACC-11). */
export class ProfileResponseDto extends UserResponseDto {
  @ApiPropertyOptional({ example: '+20 100 123 4567' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'EGP',
    description: 'Used to display itinerary budgets (ITN-18).',
  })
  preferredCurrency?: string;

  static fromUser(user: ProfileRecord): ProfileResponseDto {
    const profile = Object.assign(
      new ProfileResponseDto(),
      UserResponseDto.fromUser(user),
    );
    profile.phone = user.phone;
    profile.preferredCurrency = user.preferredCurrency;
    return profile;
  }
}
