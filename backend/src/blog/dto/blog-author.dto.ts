import { ApiProperty } from '@nestjs/swagger';
import { BlogPostListDto } from './blog-post-responses.dto';
import { AuthorItineraryListDto } from './blog-community.dto';

export class BlogAuthorPageDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, format: 'date-time' }) joinedAt: Date;
  @ApiProperty({ type: BlogPostListDto }) posts: BlogPostListDto;
  @ApiProperty({ type: AuthorItineraryListDto })
  itineraries: AuthorItineraryListDto;
}
