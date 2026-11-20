import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiParam,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PageQueryDto } from '../common/pagination';
import {
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from '../common/uploads/image-uploads.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { BlogPostsService } from './blog-posts.service';
import {
  CreateBlogPostDto,
  DeleteBlogPostDto,
  PublishedPostsQueryDto,
  AttachItineraryDto,
  UpdateBlogPostDto,
} from './dto/blog-post-requests.dto';
import {
  BlogPostDetailsDto,
  BlogPostListDto,
} from './dto/blog-post-responses.dto';

@ApiTags('Blog posts')
@ApiBadRequestResponse({
  description: 'Invalid fields or missing confirmation.',
})
@ApiNotFoundResponse({ description: 'Post not found or not accessible.' })
@ApiUnauthorizedResponse({ description: 'Log in before managing your posts.' })
@ApiForbiddenResponse({
  description: 'Account inactive or temporary password change required.',
})
@ApiConflictResponse({
  description: 'Post changed concurrently. Reload and retry.',
})
@Controller('posts')
export class BlogPostsController {
  constructor(private readonly posts: BlogPostsService) {}

  @Get()
  @ApiOperation({
    summary: 'Browse published posts (BLG-02)',
    description:
      'Public. Ten per page, newest first; optional exact tag filter. Drafts, hidden posts and deactivated authors are excluded.',
  })
  @ApiOkResponse({ type: BlogPostListDto })
  list(@Query() query: PublishedPostsQueryDto) {
    return this.posts.listPublished(query);
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search published posts (BLG-09)',
    description:
      'Keyword in title, tags or author name; optional exact tag filter. Ordered by likes plus visible comments, then newest publication first. Empty results return items:[].',
  })
  @ApiOkResponse({ type: BlogPostListDto })
  search(@Query() query: PublishedPostsQueryDto) {
    return this.posts.listPublished(query, undefined, true);
  }

  // Static routes precede :id, so mine cannot be mistaken for a public post id.
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List my posts, including drafts (BLG-03)' })
  @ApiOkResponse({ type: BlogPostListDto })
  mine(@CurrentUser() user: UserDocument, @Query() query: PageQueryDto) {
    return this.posts.listMine(user, query);
  }

  @Get('mine/:id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Read my post, including a draft (BLG-03, BLG-04)' })
  @ApiOkResponse({ type: BlogPostDetailsDto })
  own(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    return this.posts.ownDetails(user, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read a published post (BLG-02)',
    description:
      'Public. Post content, interaction counts and chronological comments (ten per page; use page for later comments).',
  })
  @ApiOkResponse({ type: BlogPostDetailsDto })
  published(@Param('id') id: string, @Query() query: PageQueryDto) {
    return this.posts.publishedDetails(id, query.page);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Create a draft or published post (BLG-01)',
    description:
      'Any active registered user. Draft by default; server sets author and publication date. Optional up to five tags. Upload images separately after creation.',
  })
  @ApiCreatedResponse({ type: BlogPostDetailsDto })
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateBlogPostDto) {
    return this.posts.create(user, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Edit my post or change draft/published status (BLG-04, BLG-08)',
    description:
      'Author only. Returning to draft removes it from public access. Republishing assigns a new publication date. Editing cannot clear moderation hiding.',
  })
  @ApiOkResponse({ type: BlogPostDetailsDto })
  update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.posts.update(user, id, dto);
  }

  @Patch(':id/itinerary')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiParam({ name: 'id', description: 'Your post id.' })
  @ApiOperation({
    summary: 'Attach an itinerary to my post (BLG-13, optional)',
    description:
      'Send one of your public itinerary ids, or null to remove it. ' +
      'Readers see it on the post page while it stays public.',
  })
  @ApiOkResponse({ type: BlogPostDetailsDto })
  @ApiBadRequestResponse({
    description: 'Not one of your public itineraries, or an invalid id.',
  })
  attachItinerary(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: AttachItineraryDto,
  ) {
    return this.posts.attachItinerary(user, id, dto.itineraryId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my post after confirmation (BLG-04)',
    description:
      'Author only, requires confirm:true. Also removes its images and dependent comments/likes.',
  })
  @ApiNoContentResponse({ description: 'Post deleted.' })
  remove(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() _dto: DeleteBlogPostDto,
  ) {
    return this.posts.remove(user, id);
  }

  @Post(':id/images')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Attach a post image (BLG-10, GEN-08)',
    description:
      'Author only. Upload one JPG/PNG up to 5 MB; at most five images per post.',
  })
  @ApiCreatedResponse({ type: BlogPostDetailsDto })
  @ApiPayloadTooLargeResponse({ description: 'Image exceeds 5 MB.' })
  image(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.posts.addImage(user, id, file);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Remove my post image (BLG-10)',
    description: 'Author only; requires confirm:true (GEN-03).',
  })
  @ApiOkResponse({ type: BlogPostDetailsDto })
  removeImage(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Body() _dto: DeleteBlogPostDto,
  ) {
    return this.posts.removeImage(user, id, imageId);
  }
}

/** BLG-08: a clicked tag lists its published posts (GET /api/tags/:tag/posts). */
@ApiTags('Blog posts')
@Controller('tags')
export class BlogTagsController {
  constructor(private readonly posts: BlogPostsService) {}

  @Get(':tag/posts')
  @ApiParam({
    name: 'tag',
    example: 'egypt',
    description: 'Up to 30 characters.',
  })
  @ApiOperation({
    summary: 'Published posts with a tag (BLG-08)',
    description:
      'Public. Same as GET /api/posts?tag=…: ten per page, newest first.',
  })
  @ApiOkResponse({ type: BlogPostListDto })
  @ApiBadRequestResponse({ description: 'Empty or longer than 30 characters.' })
  byTag(@Param('tag') tag: string, @Query() query: PageQueryDto) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || normalized.length > 30)
      throw new BadRequestException('tag must be 1 to 30 characters.');
    return this.posts.listPublished(
      Object.assign(new PublishedPostsQueryDto(), {
        page: query.page ?? 1,
        tag: normalized,
      }),
    );
  }
}
