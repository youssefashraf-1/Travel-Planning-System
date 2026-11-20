import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { NotificationQueryDto } from './dto/notification.dto';
import { Notification } from './schemas/notification.schema';

type StoredNotification = Notification & {
  _id: Types.ObjectId;
  createdAt: Date;
};
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  async list(recipientId: Types.ObjectId, query: NotificationQueryDto) {
    if (!Number.isSafeInteger((query.page - 1) * PAGE_SIZE))
      throw new BadRequestException('Page number is too large.');
    const readFilter =
      query.unread === undefined
        ? {}
        : { readAt: query.unread ? null : { $ne: null } };
    // A single aggregation keeps the page, filtered total and global unread count consistent.
    const [result] = await this.notifications
      .aggregate<{
        items: StoredNotification[];
        total: { count: number }[];
        unread: { count: number }[];
      }>([
        { $match: { recipientId } },
        {
          $facet: {
            items: [
              { $match: readFilter },
              { $sort: { createdAt: -1, _id: -1 } },
              { $skip: (query.page - 1) * PAGE_SIZE },
              { $limit: PAGE_SIZE },
            ],
            total: [{ $match: readFilter }, { $count: 'count' }],
            unread: [{ $match: { readAt: null } }, { $count: 'count' }],
          },
        },
      ])
      .exec();
    return {
      ...pageInfo(query.page, result?.total[0]?.count ?? 0),
      unreadCount: result?.unread[0]?.count ?? 0,
      items: (result?.items ?? []).map((item) => this.present(item)),
    };
  }
  async unreadCount(recipientId: Types.ObjectId) {
    return {
      unreadCount: await this.notifications
        .countDocuments({ recipientId, readAt: null })
        .exec(),
    };
  }
  async markRead(recipientId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Notification not found.');
    const item = await this.notifications
      .findOneAndUpdate(
        { _id: id, recipientId },
        [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean<StoredNotification>()
      .exec();
    if (!item) throw new NotFoundException('Notification not found.');
    return this.present(item);
  }
  async markAllRead(recipientId: Types.ObjectId) {
    const result = await this.notifications
      .updateMany(
        { recipientId, readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return { markedCount: result.modifiedCount };
  }
  private present(item: StoredNotification) {
    return {
      id: item._id.toString(),
      type: item.type,
      subjectModel: item.subjectModel,
      subjectId: item.subjectId.toString(),
      title: item.title,
      message: item.message,
      readAt: item.readAt,
      createdAt: item.createdAt,
    };
  }
}
