import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageInfoDto } from '../../common/pagination';
import { BlogPostStatus } from '../schemas/blog-post.schema';
import { BlogCommentListDto } from './blog-community.dto';

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
  @ApiProperty() excerpt: string;
  @ApiProperty({ description: 'Likes plus visible comments.' })
  interactionScore: number;
  @ApiProperty({ description: 'True when hidden by moderation.' })
  hidden: boolean;
}

/** BLG-13 (optional): the itinerary attached to a post. */
export class AttachedItineraryDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Ten days in Egypt' }) title: string;
  @ApiProperty({ example: '2027-03-01' }) startDate: string;
  @ApiProperty({ example: 10 }) dayCount: number;
  @ApiProperty({
    example: 'public',
    description: 'Readers see it only while it stays public.',
  })
  visibility: string;
}

export class BlogPostDetailsDto extends BlogPostSummaryDto {
  @ApiProperty({ description: 'Text content, not trusted HTML.' }) body: string;
  @ApiPropertyOptional({
    type: AttachedItineraryDto,
    description:
      'BLG-13: open it with GET /api/itineraries/public/:id. Missing when none is attached or it is no longer public.',
  })
  itinerary?: AttachedItineraryDto;
  @ApiProperty({ type: BlogCommentListDto }) comments: BlogCommentListDto;
}

export class BlogPostListDto extends PageInfoDto {
  @ApiProperty({ type: [BlogPostSummaryDto] }) items: BlogPostSummaryDto[];
}
