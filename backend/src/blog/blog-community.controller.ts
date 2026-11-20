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
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PageQueryDto } from '../common/pagination';
import type { UserDocument } from '../users/schemas/user.schema';
import { BlogCommunityService } from './blog-community.service';
import {
  BlogCommentDto,
  BlogCommentListDto,
  BlogLikeDto,
  CommentBodyDto,
} from './dto/blog-community.dto';
import { DeleteBlogPostDto } from './dto/blog-post-requests.dto';

@ApiTags('Blog community')
@ApiBadRequestResponse({
  description: 'Invalid body, pagination or missing confirmation.',
})
@ApiNotFoundResponse({
  description: 'Post/comment not accessible, or not your comment.',
})
@ApiUnauthorizedResponse({ description: 'Log in first.' })
@ApiForbiddenResponse({ description: 'Account cannot perform this action.' })
@Controller()
export class BlogCommunityController {
  constructor(private readonly community: BlogCommunityService) {}

  @Get('posts/:id/comments')
  @ApiOperation({
    summary: 'Read published-post comments chronologically (BLG-02, BLG-05)',
    description:
      'Public; ten per page. Hidden comments are excluded; deactivated authors show as Deleted user.',
  })
  @ApiOkResponse({ type: BlogCommentListDto })
  list(@Param('id') id: string, @Query() query: PageQueryDto) {
    return this.community.list(id, query.page);
  }

  @Get('comments/mine')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Read my own comments, including hidden ones (BLG-07, GEN-10)',
  })
  @ApiOkResponse({ type: BlogCommentListDto })
  mine(@CurrentUser() user: UserDocument, @Query() query: PageQueryDto) {
    return this.community.mine(user, query.page);
  }

  @Post('posts/:id/comments')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Comment on a published post (BLG-05)',
    description:
      'Nonblank text, at most 500 characters. Registered users only.',
  })
  @ApiCreatedResponse({ type: BlogCommentDto })
  add(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CommentBodyDto,
  ) {
    return this.community.add(user, id, dto.body);
  }

  @Patch('comments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit my comment (BLG-07)',
    description: 'Text edits cannot unhide moderated comments.',
  })
  @ApiOkResponse({ type: BlogCommentDto })
  edit(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: CommentBodyDto,
  ) {
    return this.community.edit(user, id, dto.body);
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my comment after confirmation (BLG-07, GEN-03)',
  })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _dto: DeleteBlogPostDto,
  ) {
    return this.community.remove(user, id);
  }

  @Post('posts/:id/like')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Like a published post once (BLG-06)',
    description:
      'Repeating the request is safe; one like per account and post.',
  })
  @ApiOkResponse({ type: BlogLikeDto })
  like(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.community.like(user, id, true);
  }

  @Delete('posts/:id/like')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Remove my like (BLG-06)',
    description:
      'Repeating the request is safe. Does not affect other users’ likes.',
  })
  @ApiOkResponse({ type: BlogLikeDto })
  unlike(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.community.like(user, id, false);
  }
}
