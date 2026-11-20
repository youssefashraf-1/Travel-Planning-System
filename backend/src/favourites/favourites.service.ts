import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { Hotel } from '../hotels/schemas/hotel.schema';
import {
  Itinerary,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema';
import { City } from '../reference-data/schemas/city.schema';
import { DELETED_USER } from '../reviews/reviews.service';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import {
  FavouriteDto,
  FavouriteListDto,
  ListFavouritesQueryDto,
  SaveFavouriteDto,
} from './dto/favourite.dto';
import { Favourite, FavouriteType } from './schemas/favourite.schema';

/** BON-02 (optional): saved hotels and public itineraries. */
@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name) private readonly favourites: Model<Favourite>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(City.name) private readonly cities: Model<City>,
  ) {}

  /** Saves an active hotel or a public itinerary; saving twice is harmless. */
  async save(user: UserDocument, dto: SaveFavouriteDto): Promise<FavouriteDto> {
    const targetId = new Types.ObjectId(dto.id);
    if (dto.type === FavouriteType.HOTEL) {
      if (!(await this.hotels.exists({ _id: targetId, isActive: true })))
        throw new NotFoundException('Hotel not found.');
    } else {
      const itinerary = await this.itineraries
        .findOne({
          _id: targetId,
          visibility: ItineraryVisibility.PUBLIC,
          hiddenAt: null,
        })
        .select('ownerId')
        .lean()
        .exec();
      if (!itinerary) throw new NotFoundException('Itinerary not found.');
      if (itinerary.ownerId.equals(user._id))
        throw new BadRequestException('You cannot save your own itinerary.');
    }
    await this.favourites
      .updateOne(
        { userId: user._id, type: dto.type, targetId },
        { $setOnInsert: { userId: user._id, type: dto.type, targetId } },
        { upsert: true },
      )
      .exec();
    const saved = await this.favourites
      .findOne({ userId: user._id, type: dto.type, targetId })
      .lean()
      .exec();
    const [item] = await this.present([saved!]);
    return item;
  }

  /** The traveler's saved items, newest first, 10 per page. */
  async list(
    user: UserDocument,
    query: ListFavouritesQueryDto,
  ): Promise<FavouriteListDto> {
    const page = query.page ?? 1;
    const filter = {
      userId: user._id,
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await Promise.all([
      this.favourites
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.favourites.countDocuments(filter).exec(),
    ]);
    return { ...pageInfo(page, total), items: await this.present(rows) };
  }

  async remove(
    user: UserDocument,
    type: FavouriteType,
    id: string,
  ): Promise<void> {
    const result = Types.ObjectId.isValid(id)
      ? await this.favourites
          .deleteOne({ userId: user._id, type, targetId: id })
          .exec()
      : { deletedCount: 0 };
    if (result.deletedCount === 0)
      throw new NotFoundException('This item is not in your favourites.');
  }

  /** Current details of each saved item, loaded in a few queries. */
  private async present(
    rows: (Favourite & { _id: Types.ObjectId; createdAt?: Date })[],
  ): Promise<FavouriteDto[]> {
    const ids = (type: FavouriteType) =>
      rows.filter((r) => r.type === type).map((r) => r.targetId);
    const [hotels, itineraries] = await Promise.all([
      this.hotels
        .find({ _id: { $in: ids(FavouriteType.HOTEL) } })
        .lean()
        .exec(),
      this.itineraries
        .find({ _id: { $in: ids(FavouriteType.ITINERARY) } })
        .select('title ownerId days visibility hiddenAt')
        .lean()
        .exec(),
    ]);
    const [cities, owners] = await Promise.all([
      this.cities
        .find({ _id: { $in: hotels.map((h) => h.cityId) } })
        .lean()
        .exec(),
      this.users
        .find({ _id: { $in: itineraries.map((i) => i.ownerId) } })
        .select('name status')
        .lean()
        .exec(),
    ]);
    const hotelById = new Map(hotels.map((h) => [h._id.toString(), h]));
    const itineraryById = new Map(
      itineraries.map((i) => [i._id.toString(), i]),
    );
    const cityName = new Map(cities.map((c) => [c._id, c.name]));
    const ownerById = new Map(owners.map((o) => [o._id.toString(), o]));

    return rows.map((row) => {
      const savedAt = row.createdAt as Date;
      const id = row.targetId.toString();
      if (row.type === FavouriteType.HOTEL) {
        const hotel = hotelById.get(id);
        return {
          type: row.type,
          id,
          title: hotel?.name ?? 'Hotel no longer available',
          subtitle: hotel
            ? `${cityName.get(hotel.cityId) ?? hotel.cityId} · ${hotel.starClass} stars`
            : '',
          photoUrl: hotel?.photos[0]?.url,
          available: !!hotel?.isActive,
          savedAt,
        };
      }
      const itinerary = itineraryById.get(id);
      const owner = itinerary
        ? ownerById.get(itinerary.ownerId.toString())
        : undefined;
      const visible =
        !!itinerary &&
        itinerary.visibility === ItineraryVisibility.PUBLIC &&
        itinerary.hiddenAt == null &&
        owner?.status !== UserStatus.DEACTIVATED;
      return {
        type: row.type,
        id,
        title: visible ? itinerary.title : 'Itinerary no longer public',
        subtitle: visible
          ? `by ${owner?.name ?? DELETED_USER} · ${itinerary.days.length} day(s)`
          : '',
        available: visible,
        savedAt,
      };
    });
  }
}
