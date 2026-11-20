import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PageInfoDto, PageQueryDto } from '../../common/pagination';
import { FavouriteType } from '../schemas/favourite.schema';

export class SaveFavouriteDto {
  @ApiProperty({ enum: FavouriteType, example: FavouriteType.HOTEL })
  @IsEnum(FavouriteType)
  type: FavouriteType;

  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  id: string;
}

export class ListFavouritesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: FavouriteType })
  @IsOptional()
  @IsEnum(FavouriteType)
  type?: FavouriteType;
}

export class FavouriteDto {
  @ApiProperty({ enum: FavouriteType }) type: FavouriteType;
  @ApiProperty({ description: 'The hotel or itinerary id.' }) id: string;
  @ApiProperty({ example: 'Nile View Hotel' }) title: string;
  @ApiProperty({
    example: 'Cairo · 4 stars',
    description: 'Hotel: city and stars. Itinerary: author and length.',
  })
  subtitle: string;
  @ApiPropertyOptional({ description: 'Hotel photo, if any.' })
  photoUrl?: string;
  @ApiProperty({
    description:
      'False when the hotel was deactivated or the itinerary is no longer public; remove it or keep it for later.',
  })
  available: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) savedAt: Date;
}

export class FavouriteListDto extends PageInfoDto {
  @ApiProperty({ type: [FavouriteDto] }) items: FavouriteDto[];
}
