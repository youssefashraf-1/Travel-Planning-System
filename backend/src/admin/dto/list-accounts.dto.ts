import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { UserRole, UserStatus } from '../../users/schemas/user.schema';

/** ACC-14: search by name or email and filter by role and status. */
export class ListAccountsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description:
      'Matches part of the name or email, ignoring case (for example "mona").',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class AccountListResponseDto extends PageInfoDto {
  @ApiProperty({
    type: [UserResponseDto],
    description: 'Newest accounts first.',
  })
  items: UserResponseDto[];
}
