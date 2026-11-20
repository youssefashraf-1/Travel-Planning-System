import { ConfirmActionDto } from '../common/dto/confirm-action.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PageQueryDto } from '../common/pagination';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  CreateReviewDto,
  HotelReviewListDto,
  MyReviewDto,
  ReplyToReviewDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Hotel reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TRAVELER)
  @ApiCookieAuth()
  @ApiParam({ name: 'id', description: 'Your hotel reservation id.' })
  @ApiOperation({
    summary: 'Rate and review a completed stay (HTL-23)',
    description:
      'One rating (1-5) and optional text (up to 1000 characters) per ' +
      'completed reservation, whatever the number of rooms. A reservation ' +
      'is completed once its check-out time has passed.',
  })
  @ApiCreatedResponse({ type: MyReviewDto })
  @ApiBadRequestResponse({ description: 'Invalid rating or text.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  @ApiForbiddenResponse({ description: 'Only travelers write reviews.' })
  @ApiNotFoundResponse({ description: 'Not found, or not your reservation.' })
  @ApiConflictResponse({ description: 'Not completed, or already reviewed.' })
  create(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<MyReviewDto> {
    return this.reviews.create(user, id, dto);
  }

  @Patch('reviews/:id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiParam({ name: 'id', description: 'The review id.' })
  @ApiOperation({
    summary: 'Edit my review (HTL-23)',
    description: 'Change the rating and/or text. Send "" to remove the text.',
  })
  @ApiOkResponse({ type: MyReviewDto })
  @ApiBadRequestResponse({ description: 'Nothing to change, or invalid.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  @ApiNotFoundResponse({ description: 'Not found, or not your review.' })
  update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<MyReviewDto> {
    return this.reviews.update(user, id, dto);
  }

  @Post('reviews/:id/reply')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth()
  @ApiParam({ name: 'id', description: 'The review id.' })
  @ApiOperation({
    summary: 'Reply to a review of my hotel (HTL-26, optional)',
    description:
      "Only the moderator of the review's hotel. Shown under the review; " +
      'posting again replaces the reply.',
  })
  @ApiOkResponse({ type: ReviewDto })
  @ApiBadRequestResponse({
    description: 'Empty or longer than 1000 characters.',
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  @ApiForbiddenResponse({ description: "Not this hotel's moderator." })
  @ApiNotFoundResponse({ description: 'Review not found or hidden.' })
  reply(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: ReplyToReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.reply(user, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiParam({ name: 'id', description: 'The review id.' })
  @ApiOperation({
    summary: 'Delete my review (HTL-23)',
    description: "The hotel's average rating updates immediately.",
  })
  @ApiNoContentResponse({ description: 'Review deleted.' })
  @ApiUnauthorizedResponse({ description: 'Not logged in.' })
  @ApiNotFoundResponse({ description: 'Not found, or not your review.' })
  remove(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _confirmation: ConfirmActionDto,
  ): Promise<void> {
    return this.reviews.remove(user, id);
  }

  @Get('hotels/:id/reviews')
  @ApiParam({ name: 'id', description: 'The hotel id.' })
  @ApiOperation({
    summary: "A hotel's rating and reviews (HTL-24)",
    description:
      'Public. Average rating (one decimal), number of ratings, and ' +
      'reviews newest first, 10 per page.',
  })
  @ApiOkResponse({ type: HotelReviewListDto })
  @ApiBadRequestResponse({ description: 'Invalid page.' })
  @ApiNotFoundResponse({ description: 'Hotel not found.' })
  listForHotel(
    @Param('id') id: string,
    @Query() query: PageQueryDto,
  ): Promise<HotelReviewListDto> {
    return this.reviews.listForHotel(id, query.page);
  }
}
