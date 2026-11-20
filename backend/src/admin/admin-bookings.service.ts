import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { ProviderType } from '../auth/access';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { User } from '../users/schemas/user.schema';
import {
  AdminBookingListDto,
  AdminBookingsQueryDto,
  AdminBookingType,
  checkAdminPageAndDates,
} from './dto/admin-operations.dto';

interface BookingRow {
  _id: Types.ObjectId;
  type: AdminBookingType;
  reference?: string;
  userId: Types.ObjectId;
  user?: { name: string; email?: string };
  providerIds: Types.ObjectId[];
  providers: { _id: Types.ObjectId; name: string; isActive: boolean }[];
  startDate?: string;
  endDate?: string;
  departureAt?: Date;
  arrivalAt?: Date;
  totalMinorUnits: number;
  currency: string;
  status: FlightBooking['status'];
  createdAt: Date;
}

/** ACC-17: one normalized, read-only page across both booking collections. */
@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotels: Model<HotelBooking>,
    @InjectModel(Flight.name) private readonly schedules: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly providers: Model<Hotel>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async list(query: AdminBookingsQueryDto): Promise<AdminBookingListDto> {
    checkAdminPageAndDates(query);
    const pipeline =
      query.type === AdminBookingType.HOTEL
        ? this.hotelPipeline(query)
        : this.flightPipeline(query);
    if (!query.type)
      pipeline.push({
        $unionWith: {
          coll: this.hotels.collection.name,
          pipeline: this.hotelPipeline(query),
        },
      });
    if (query.fromDate || query.toDate)
      pipeline.push({
        $match: {
          startDate: {
            ...(query.fromDate ? { $gte: query.fromDate } : {}),
            ...(query.toDate ? { $lte: query.toDate } : {}),
          },
        },
      });
    pipeline.push({
      $facet: {
        items: [
          { $sort: { createdAt: -1, _id: -1, type: 1 } },
          { $skip: (query.page - 1) * PAGE_SIZE },
          { $limit: PAGE_SIZE },
          {
            $lookup: {
              from: this.users.collection.name,
              localField: 'userId',
              foreignField: '_id',
              pipeline: [{ $project: { name: 1, email: 1 } }],
              as: 'user',
            },
          },
          { $set: { user: { $arrayElemAt: ['$user', 0] } } },
        ],
        total: [{ $count: 'count' }],
      },
    });
    const model =
      query.type === AdminBookingType.HOTEL ? this.hotels : this.flights;
    const [result] = await model
      .aggregate<{ items: BookingRow[]; total: { count: number }[] }>(pipeline)
      .exec();
    return {
      ...pageInfo(query.page, result?.total[0]?.count ?? 0),
      items: (result?.items ?? []).map((row) => ({
        id: row._id.toString(),
        type: row.type,
        reference: row.reference,
        user: {
          id: row.userId.toString(),
          name: row.user?.name ?? 'Deleted user',
          email: row.user?.email,
        },
        providers: [...new Set(row.providerIds.map((id) => id.toString()))].map(
          (id) => {
            const provider = row.providers.find(
              (item) => item._id.toString() === id,
            );
            return {
              id,
              type:
                row.type === AdminBookingType.FLIGHT
                  ? ProviderType.AIRLINE
                  : ProviderType.HOTEL,
              name: provider?.name ?? 'Deleted provider',
              isActive: provider?.isActive ?? false,
            };
          },
        ),
        startDate: row.startDate,
        endDate: row.endDate,
        departureAt: row.departureAt,
        arrivalAt: row.arrivalAt,
        amountMinorUnits: row.totalMinorUnits,
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt,
      })),
    };
  }

  private flightPipeline(query: AdminBookingsQueryDto): PipelineStage[] {
    return [
      { $match: query.status ? { status: query.status } : {} },
      {
        $lookup: {
          from: this.schedules.collection.name,
          localField: 'segments.flightId',
          foreignField: '_id',
          pipeline: [
            {
              $project: { departureAt: 1, arrivalAt: 1, departureLocalDate: 1 },
            },
          ],
          as: 'schedules',
        },
      },
      {
        $set: {
          firstFlight: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$schedules',
                  as: 'flight',
                  cond: {
                    $eq: [
                      '$$flight._id',
                      { $arrayElemAt: ['$segments.flightId', 0] },
                    ],
                  },
                },
              },
              0,
            ],
          },
          lastFlight: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$schedules',
                  as: 'flight',
                  cond: {
                    $eq: [
                      '$$flight._id',
                      { $arrayElemAt: ['$segments.flightId', -1] },
                    ],
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $project: {
          _id: 1,
          type: { $literal: AdminBookingType.FLIGHT },
          reference: 1,
          userId: 1,
          status: 1,
          totalMinorUnits: 1,
          currency: 1,
          createdAt: 1,
          providerIds: '$segments.airlineId',
          startDate: '$firstFlight.departureLocalDate',
          departureAt: '$firstFlight.departureAt',
          arrivalAt: '$lastFlight.arrivalAt',
        },
      },
      {
        $lookup: {
          from: this.airlines.collection.name,
          localField: 'providerIds',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, isActive: 1 } }],
          as: 'providers',
        },
      },
    ];
  }

  private hotelPipeline(
    query: AdminBookingsQueryDto,
  ): PipelineStage.UnionWithPipelineStage[] {
    return [
      { $match: query.status ? { status: query.status } : {} },
      {
        $project: {
          _id: 1,
          type: { $literal: AdminBookingType.HOTEL },
          reference: 1,
          userId: 1,
          status: 1,
          totalMinorUnits: 1,
          currency: 1,
          createdAt: 1,
          providerIds: ['$hotelId'],
          startDate: '$checkInDate',
          endDate: '$checkOutDate',
        },
      },
      {
        $lookup: {
          from: this.providers.collection.name,
          localField: 'providerIds',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, isActive: 1 } }],
          as: 'providers',
        },
      },
    ];
  }
}
