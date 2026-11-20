import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { BlogPostStatus } from '../schemas/blog-post.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** BLG-01, BLG-08: images are uploaded separately, never arbitrary URLs. */
export class CreateBlogPostDto {
  @ApiProperty({ example: 'My trip to Cairo' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'We spent the morning visiting the museum.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ enum: BlogPostStatus, default: BlogPostStatus.DRAFT })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(BlogPostStatus)
  status?: BlogPostStatus;

  @ApiPropertyOptional({ type: [String], maxItems: 5, example: ['egypt'] })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((tag: unknown) =>
          typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
        )
      : value,
  )
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}

export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto, {
  skipNullProperties: false,
}) {}

export class PublishedPostsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'egypt', maxLength: 30 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  tag?: string;
}

/** GEN-03: deleting a post requires an explicit confirmation. */
export class DeleteBlogPostDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true)
  confirm: boolean;
}
