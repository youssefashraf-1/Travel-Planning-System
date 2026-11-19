import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { escapeRegExp, PAGE_SIZE, pageInfo } from '../common/pagination';
import { ListAirportsQueryDto } from './dto/list-airports.dto';
import { Airport } from './schemas/airport.schema';

@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
  ) {}

  async list(query: ListAirportsQueryDto) {
    const filter: QueryFilter<Airport> = {};
    if (query.countryCode) filter.countryCode = query.countryCode;
    if (query.search) {
      const pattern = new RegExp(escapeRegExp(query.search), 'i');
      filter.$or = [
        { iataCode: pattern },
        { name: pattern },
        { cityId: pattern },
        { countryCode: pattern },
      ];
    }
    const page = query.page ?? 1;
    const [items, totalItems] = await Promise.all([
      this.airports
        .find(filter)
        .sort({ iataCode: 1, _id: 1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean()
        .exec(),
      this.airports.countDocuments(filter).exec(),
    ]);
    return Object.assign({ items }, pageInfo(page, totalItems));
  }
}
