import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageInfoDto } from '../../common/pagination';

/** HTL-23: one rating per completed reservation, with optional text. */
export class CreateReviewDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    example: 'Lovely staff and a great view of the Nile.',
    maxLength: 1000,
    description: 'Optional. Send "" to remove the text when editing.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  body?: string;
}

export class UpdateReviewDto extends PartialType(CreateReviewDto) {}

/** HTL-26 (optional): a hotel's reply to a review. */
export class ReplyToReviewDto {
  @ApiProperty({
    example: 'Thank you for staying with us!',
    maxLength: 1000,
    description: 'Replaces any earlier reply.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  body: string;
}

export class ReviewReplyViewDto {
  @ApiProperty({ example: 'Thank you for staying with us!' }) body: string;
  @ApiProperty({ type: String, format: 'date-time' }) repliedAt: Date;
}

export class ReviewDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 5 }) rating: number;
  @ApiPropertyOptional({ example: 'Lovely staff.' }) body?: string;
  @ApiProperty({
    example: 'Mona Hassan',
    description:
      'Shown as "Deleted user" once the author deactivates (ACC-12).',
  })
  authorName: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiPropertyOptional({
    type: ReviewReplyViewDto,
    description: 'HTL-26: the hotel’s reply, if any.',
  })
  reply?: ReviewReplyViewDto;
}

export class MyReviewDto extends ReviewDto {
  @ApiProperty() hotelId: string;
  @ApiProperty() bookingId: string;
}

/** HTL-24: rating summary and reviews, newest first. */
export class HotelReviewListDto extends PageInfoDto {
  @ApiPropertyOptional({ example: 4.3, description: 'None while unrated.' })
  averageRating?: number;
  @ApiProperty({ example: 12 }) ratingCount: number;
  @ApiProperty({ type: [ReviewDto] }) items: ReviewDto[];
}
