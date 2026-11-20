import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { User } from '../users/schemas/user.schema';
import {
  AdminAuditListDto,
  AdminAuditQueryDto,
  checkAdminPageAndDates,
} from './dto/admin-operations.dto';

@Injectable()
export class AdminAuditService {
  constructor(
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async list(query: AdminAuditQueryDto): Promise<AdminAuditListDto> {
    checkAdminPageAndDates(query);
    const filter: QueryFilter<AuditLog> = {};
    if (query.action) filter.action = query.action;
    if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId);
    if (query.targetModel) filter.targetModel = query.targetModel;
    if (query.targetId) filter.targetId = new Types.ObjectId(query.targetId);
    if (query.fromDate || query.toDate)
      filter.createdAt = {
        ...(query.fromDate
          ? { $gte: new Date(query.fromDate + 'T00:00:00.000Z') }
          : {}),
        ...(query.toDate
          ? {
              $lt: new Date(
                Date.parse(query.toDate + 'T00:00:00.000Z') + 86400000,
              ),
            }
          : {}),
      };
    const [items, count] = await Promise.all([
      this.audit
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<(AuditLog & { _id: Types.ObjectId; createdAt: Date })[]>()
        .exec(),
      this.audit.countDocuments(filter).exec(),
    ]);
    const actors = await this.users
      .find({ _id: { $in: items.map((item) => item.actorId) } })
      .select('_id name')
      .lean()
      .exec();
    const names = new Map(
      actors.map((actor) => [actor._id.toString(), actor.name]),
    );
    return {
      ...pageInfo(query.page, count),
      items: items.map((item) => ({
        id: item._id.toString(),
        actorId: item.actorId.toString(),
        actorName: names.get(item.actorId.toString()) ?? 'Deleted user',
        action: item.action,
        targetModel: item.targetModel,
        targetId: item.targetId.toString(),
        reportId: item.reportId?.toString(),
        createdAt: item.createdAt,
      })),
    };
  }
}
