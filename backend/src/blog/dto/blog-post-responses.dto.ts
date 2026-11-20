import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageInfoDto } from '../../common/pagination';
import { BlogPostStatus } from '../schemas/blog-post.schema';

export class BlogAuthorDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class BlogImageDto {
  @ApiProperty() id: string;
  @ApiProperty() url: string;
}

export class BlogPostSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: BlogPostStatus }) status: BlogPostStatus;
  @ApiProperty({ type: BlogAuthorDto }) author: BlogAuthorDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  publishedAt?: Date;
  @ApiProperty({ type: [String] }) tags: string[];
  @ApiProperty({ type: [BlogImageDto] }) images: BlogImageDto[];
  @ApiProperty() likeCount: number;
  @ApiProperty() commentCount: number;
  @ApiProperty({ description: 'True when hidden by moderation.' })
  hidden: boolean;
}

export class BlogPostDetailsDto extends BlogPostSummaryDto {
  @ApiProperty({ description: 'Text content, not trusted HTML.' }) body: string;
}

export class BlogPostListDto extends PageInfoDto {
  @ApiProperty({ type: [BlogPostSummaryDto] }) items: BlogPostSummaryDto[];
}
