import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';

export class CommentBodyDto {
  @ApiProperty({ example: 'Thank you for sharing!', maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;
}

export class BlogCommentDto {
  @ApiProperty() id: string;
  @ApiProperty() postId: string;
  @ApiProperty() body: string;
  @ApiProperty() authorName: string;
  @ApiPropertyOptional({ description: 'Omitted for deleted users.' })
  authorId?: string;
  @ApiProperty() hidden: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class BlogCommentListDto extends PageInfoDto {
  @ApiProperty({ type: [BlogCommentDto] }) items: BlogCommentDto[];
}

export class BlogLikeDto {
  @ApiProperty() liked: boolean;
  @ApiProperty() likeCount: number;
}

export class AuthorPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    default: 1,
    description: 'Independent page for public itineraries.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage: number = 1;
}

export class AuthorItineraryDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: [String] }) countryCodes: string[];
  @ApiProperty() startDate: string;
  @ApiProperty() numberOfDays: number;
}

export class AuthorItineraryListDto extends PageInfoDto {
  @ApiProperty({ type: [AuthorItineraryDto] }) items: AuthorItineraryDto[];
}
