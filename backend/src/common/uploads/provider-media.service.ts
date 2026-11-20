import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Airline } from '../../airlines/schemas/airline.schema';
import { Hotel } from '../../hotels/schemas/hotel.schema';
import {
  ImageUploadsService,
  type UploadedImage,
} from './image-uploads.service';

export class ProviderPhotoDto {
  @ApiProperty() id: string;
  @ApiProperty() url: string;
}
export class ProviderLogoDto {
  @ApiPropertyOptional() logoUrl?: string;
}
type StoredHotel = { photos: { _id: Types.ObjectId; url: string }[] };
type StoredAirline = { logoUrl?: string };

/** GEN-08: atomic media changes avoid lost uploads and enforce the five-photo limit. */
@Injectable()
export class ProviderMediaService {
  constructor(
    @InjectConnection() private readonly db: Connection,
    private readonly uploads: ImageUploadsService,
  ) {}
  async addPhoto(
    id: string,
    file: UploadedImage | undefined,
  ): Promise<ProviderPhotoDto[]> {
    const hotels = this.db.model<StoredHotel>(Hotel.name);
    if (!(await hotels.exists({ _id: id })))
      throw new NotFoundException('Hotel not found.');
    const url = await this.uploads.save(file, 'hotels');
    try {
      const hotel = await hotels
        .findOneAndUpdate(
          { _id: id, $expr: { $lt: [{ $size: '$photos' }, 5] } },
          {
            $push: { photos: { _id: new Types.ObjectId(), url } },
            $inc: { __v: 1 },
          },
          { returnDocument: 'after', runValidators: true },
        )
        .exec();
      if (!hotel)
        throw new ConflictException(
          'Hotel not found or already has five photos.',
        );
      return hotel.photos.map((photo) => ({
        id: photo._id.toString(),
        url: photo.url,
      }));
    } catch (error) {
      await this.uploads.remove(url);
      throw error;
    }
  }
  async removePhoto(id: string, photoId: string): Promise<ProviderPhotoDto[]> {
    if (!Types.ObjectId.isValid(photoId))
      throw new NotFoundException('Photo not found.');
    const hotel = await this.db
      .model<StoredHotel>(Hotel.name)
      .findOneAndUpdate(
        { _id: id, 'photos._id': photoId },
        {
          $pull: { photos: { _id: new Types.ObjectId(photoId) } },
          $inc: { __v: 1 },
        },
        { returnDocument: 'before' },
      )
      .exec();
    if (!hotel) throw new NotFoundException('Photo not found.');
    const removed = hotel.photos.find(
      (photo) => photo._id.toString() === photoId,
    )!;
    await this.uploads.remove(removed.url);
    return hotel.photos
      .filter((photo) => photo._id.toString() !== photoId)
      .map((photo) => ({ id: photo._id.toString(), url: photo.url }));
  }
  async setLogo(
    id: string,
    file: UploadedImage | undefined,
  ): Promise<ProviderLogoDto> {
    const airlines = this.db.model<StoredAirline>(Airline.name);
    if (!(await airlines.exists({ _id: id })))
      throw new NotFoundException('Airline not found.');
    const url = await this.uploads.save(file, 'airlines');
    let previous: StoredAirline | null;
    try {
      previous = await airlines
        .findByIdAndUpdate(
          id,
          { $set: { logoUrl: url }, $inc: { __v: 1 } },
          { returnDocument: 'before' },
        )
        .exec();
      if (!previous) throw new NotFoundException('Airline not found.');
    } catch (error) {
      await this.uploads.remove(url);
      throw error;
    }
    if (previous.logoUrl) await this.uploads.remove(previous.logoUrl);
    return { logoUrl: url };
  }
  async removeLogo(id: string): Promise<ProviderLogoDto> {
    const previous = await this.db
      .model<StoredAirline>(Airline.name)
      .findByIdAndUpdate(
        id,
        { $unset: { logoUrl: 1 }, $inc: { __v: 1 } },
        { returnDocument: 'before' },
      )
      .exec();
    if (!previous) throw new NotFoundException('Airline not found.');
    if (previous.logoUrl) await this.uploads.remove(previous.logoUrl);
    return {};
  }
}
