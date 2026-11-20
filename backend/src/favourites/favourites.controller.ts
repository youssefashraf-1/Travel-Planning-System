import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, type UserDocument } from '../users/schemas/user.schema';
import {
  FavouriteDto,
  FavouriteListDto,
  ListFavouritesQueryDto,
  SaveFavouriteDto,
} from './dto/favourite.dto';
import { FavouritesService } from './favourites.service';
import { FavouriteType } from './schemas/favourite.schema';

@ApiTags('Favourites')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in.' })
@ApiForbiddenResponse({ description: 'Only travelers have favourites.' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TRAVELER)
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post()
  @ApiOperation({
    summary: 'Save a hotel or public itinerary (BON-02, optional)',
    description: 'Saving the same item again changes nothing.',
  })
  @ApiCreatedResponse({ type: FavouriteDto })
  @ApiBadRequestResponse({
    description: 'Invalid input, or your own itinerary.',
  })
  @ApiNotFoundResponse({
    description: 'Hotel not active, or itinerary not public.',
  })
  save(
    @CurrentUser() user: UserDocument,
    @Body() dto: SaveFavouriteDto,
  ): Promise<FavouriteDto> {
    return this.favourites.save(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'My favourites (BON-02, optional)',
    description:
      'Newest first, 10 per page, optionally only hotels or itineraries. ' +
      'Items no longer available are marked available:false.',
  })
  @ApiOkResponse({ type: FavouriteListDto })
  list(
    @CurrentUser() user: UserDocument,
    @Query() query: ListFavouritesQueryDto,
  ): Promise<FavouriteListDto> {
    return this.favourites.list(user, query);
  }

  @Delete(':type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'type', enum: FavouriteType })
  @ApiParam({ name: 'id', description: 'The hotel or itinerary id.' })
  @ApiOperation({ summary: 'Remove a favourite (BON-02, optional)' })
  @ApiNoContentResponse({ description: 'Removed.' })
  @ApiNotFoundResponse({ description: 'Not in your favourites.' })
  remove(
    @CurrentUser() user: UserDocument,
    @Param('type', new ParseEnumPipe(FavouriteType)) type: FavouriteType,
    @Param('id') id: string,
  ): Promise<void> {
    return this.favourites.remove(user, type, id);
  }
}
