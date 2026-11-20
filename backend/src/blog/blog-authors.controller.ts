import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BlogAuthorsService } from './blog-authors.service';
import { BlogAuthorPageDto } from './dto/blog-author.dto';
import { AuthorPageQueryDto } from './dto/blog-community.dto';

@ApiTags('Blog authors')
@Controller('authors')
export class BlogAuthorsController {
  constructor(private readonly authors: BlogAuthorsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Public author page (BLG-12)',
    description:
      'Name, join date, published visible posts and public visible itineraries. page and itinerariesPage independently paginate the two lists. Deactivated accounts return 404.',
  })
  @ApiOkResponse({ type: BlogAuthorPageDto })
  @ApiNotFoundResponse({ description: 'Author not found.' })
  @ApiBadRequestResponse({ description: 'Invalid pagination.' })
  page(@Param('id') id: string, @Query() query: AuthorPageQueryDto) {
    return this.authors.page(id, query);
  }
}
