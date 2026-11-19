import { ApiProperty } from '@nestjs/swagger';
import { User, UserRole, UserStatus } from '../schemas/user.schema';

type UserRecord = Pick<
  User,
  'name' | 'email' | 'role' | 'status' | 'mustChangePassword'
> & {
  _id: { toString(): string };
  createdAt?: Date;
};

/**
 * The account fields that are safe to send to a client. It is built field by
 * field, so secrets such as the password hash can never leak by accident.
 */
export class UserResponseDto {
  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Mona Hassan' })
  name: string;

  @ApiProperty({ example: 'mona.hassan@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.TRAVELER })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({
    description:
      'True when the user must set a new password before continuing ' +
      '(admin reset or first moderator login).',
    example: false,
  })
  mustChangePassword: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt?: Date;

  static fromUser(user: UserRecord): UserResponseDto {
    const response = new UserResponseDto();
    response.id = user._id.toString();
    response.name = user.name;
    response.email = user.email;
    response.role = user.role;
    response.status = user.status;
    response.mustChangePassword = user.mustChangePassword ?? false;
    response.createdAt = user.createdAt;
    return response;
  }
}
