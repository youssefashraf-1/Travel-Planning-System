import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { AuditAction, AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { ProviderType } from '../auth/access';
import { BookingStatus } from '../common/booking-status';
import { escapeRegExp, PAGE_SIZE, pageInfo } from '../common/pagination';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../users/schemas/user.schema';
import {
  AdminProviderDto,
  AdminProviderListDto,
  checkAdminPageAndDates,
  ProviderListQueryDto,
} from './dto/admin-operations.dto';

type Provider = { _id: Types.ObjectId; name: string; isActive: boolean };

@Injectable()
export class AdminProvidersService {
  constructor(
    @InjectConnection() private readonly db: Connection,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotels: Model<HotelBooking>,
  ) {}

  async list(
    type: ProviderType,
    query: ProviderListQueryDto,
  ): Promise<AdminProviderListDto> {
    checkAdminPageAndDates(query);
    const filter = {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? { name: new RegExp(escapeRegExp(query.search), 'i') }
        : {}),
    };
    const model = this.model(type);
    const [items, count] = await Promise.all([
      model
        .find(filter)
        .select('_id name isActive')
        .sort({ name: 1, _id: 1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<Provider[]>()
        .exec(),
      model.countDocuments(filter).exec(),
    ]);
    return {
      ...pageInfo(query.page, count),
      items: items.map((item) => this.present(type, item)),
    };
  }

  /** ACC-15: provider state, pending holds, notifications and audit commit together. */
  async setActive(
    admin: UserDocument,
    type: ProviderType,
    id: string,
    active: boolean,
  ): Promise<AdminProviderDto> {
    const result = await this.db.transaction(async (session) => {
      const provider = Types.ObjectId.isValid(id)
        ? await this.model(type).findById(id).session(session).exec()
        : null;
      if (!provider) throw new NotFoundException('Provider not found.');
      if (provider.isActive === active)
        throw new ConflictException(
          active
            ? 'Provider is already active.'
            : 'Provider is already inactive.',
        );
      const now = new Date();
      const updated = await this.model(type)
        .findOneAndUpdate(
          { _id: provider._id, isActive: !active },
          {
            $set: { isActive: active },
            $inc: { __v: 1 },
          },
          { session, returnDocument: 'after' },
        )
        .exec();
      if (!updated)
        throw new ConflictException('Provider changed. Reload and retry.');
      const filter =
        type === ProviderType.AIRLINE
          ? { 'segments.airlineId': provider._id }
          : { hotelId: provider._id };
      const bookingModel = this.db.model<{ userId: Types.ObjectId }>(
        type === ProviderType.AIRLINE ? FlightBooking.name : HotelBooking.name,
      );
      const bookings = await bookingModel
        .find({
          ...filter,
          $or: [
            { status: BookingStatus.CONFIRMED },
            {
              status: BookingStatus.PENDING_PAYMENT,
              holdExpiresAt: { $gt: now },
            },
          ],
        })
        .select('userId')
        .session(session)
        .lean()
        .exec();
      if (!active) {
        // Keep the valid lifecycle: the existing expiry jobs perform Pending -> Expired.
        // A confirmation racing this write retries and sees an ended hold; late captures use the existing refund path.
        const expired = {
          ...filter,
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $gt: now },
        };
        if (type === ProviderType.AIRLINE)
          await this.flights
            .updateMany(expired, { $set: { holdExpiresAt: now } }, { session })
            .exec();
        else
          await this.hotels
            .updateMany(expired, { $set: { holdExpiresAt: now } }, { session })
            .exec();
      }
      const entry = await this.audit.create(
        [
          {
            actorId: admin._id,
            action: active
              ? AuditAction.PROVIDER_REACTIVATED
              : AuditAction.PROVIDER_DEACTIVATED,
            targetModel:
              type === ProviderType.AIRLINE ? Airline.name : Hotel.name,
            targetId: provider._id,
          },
        ],
        { session },
      );
      const recipients = await this.users
        .find({
          status: { $ne: UserStatus.DEACTIVATED },
          $or: [
            { _id: { $in: bookings.map((booking) => booking.userId) } },
            {
              assignedProviderId: provider._id,
              role:
                type === ProviderType.AIRLINE
                  ? UserRole.AIRLINE_MODERATOR
                  : UserRole.HOTEL_MODERATOR,
            },
          ],
        })
        .select('_id')
        .session(session)
        .lean()
        .exec();
      if (recipients.length)
        await this.notifications.create(
          recipients.map((user) => ({
            recipientId: user._id,
            type: NotificationType.PROVIDER_STATUS_CHANGED,
            subjectModel:
              type === ProviderType.AIRLINE ? Airline.name : Hotel.name,
            subjectId: provider._id,
            title: active ? 'Provider reactivated' : 'Provider deactivated',
            message: active
              ? `${provider.name} is taking bookings again. Existing confirmed bookings remain valid; expired holds are not restored.`
              : `${provider.name} is no longer taking new bookings. Existing confirmed bookings remain valid. Pending payment holds have ended.`,
            eventKey: `provider-status:${entry[0]._id.toString()}`,
          })),
          { session, ordered: true },
        );
      return this.present(type, updated);
    });
    return result;
  }

  private model(type: ProviderType): Model<Provider> {
    return this.db.model<Provider>(
      type === ProviderType.AIRLINE ? Airline.name : Hotel.name,
    );
  }
  private present(type: ProviderType, row: Provider): AdminProviderDto {
    return {
      id: row._id.toString(),
      type,
      name: row.name,
      isActive: row.isActive,
    };
  }
}
