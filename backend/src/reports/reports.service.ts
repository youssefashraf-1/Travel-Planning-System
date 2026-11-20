import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditAction, AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { BlogVisibilityService } from '../blog/blog-visibility.service';
import { BlogPost } from '../blog/schemas/blog-post.schema';
import { Comment } from '../blog/schemas/comment.schema';
import { Like } from '../blog/schemas/like.schema';
import { PAGE_SIZE, pageInfo } from '../common/pagination';
import { ImageUploadsService } from '../common/uploads/image-uploads.service';
import {
  Itinerary,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema';
import { Review } from '../reviews/schemas/review.schema';
import { User, UserDocument, UserStatus } from '../users/schemas/user.schema';
import {
  ContentType,
  CreateReportDto,
  ModeratedContentDto,
  ReportDto,
  ReportListDto,
  ReportResolution,
  ReportsQueryDto,
} from './dto/report.dto';
import { Report, ReportStatus } from './schemas/report.schema';

const MODEL = {
  [ContentType.POST]: BlogPost.name,
  [ContentType.COMMENT]: Comment.name,
  [ContentType.REVIEW]: Review.name,
  [ContentType.ITINERARY]: Itinerary.name,
};
type Content = {
  _id: Types.ObjectId;
  authorId?: Types.ObjectId;
  ownerId?: Types.ObjectId;
  postId?: Types.ObjectId;
  hiddenAt?: Date;
  visibility?: string;
  images?: { url: string }[];
  days?: { activities: { images: { url: string }[] }[] }[];
  [key: string]: unknown;
};
type StoredReport = Report & { _id: Types.ObjectId; createdAt: Date };

/** GEN-09/10: reports, guarded moderation and audit records share one transaction. */
@Injectable()
export class ReportsService {
  constructor(
    @InjectConnection() private readonly db: Connection,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    private readonly visibility: BlogVisibilityService,
    private readonly uploads: ImageUploadsService,
  ) {}

  async create(user: UserDocument, dto: CreateReportDto): Promise<ReportDto> {
    const id = new Types.ObjectId();
    try {
      await this.db.transaction(async (session) => {
        const target = await this.target(dto.targetType, dto.targetId, session);
        if (target.hiddenAt != null)
          throw new NotFoundException('Content not found.');
        if (dto.targetType === ContentType.POST)
          await this.visibility.publicPost(dto.targetId, session);
        if (dto.targetType === ContentType.COMMENT)
          await this.visibility.publicPost(target.postId!.toString(), session);
        if (dto.targetType === ContentType.ITINERARY) {
          const author = await this.users
            .exists({
              _id: target.ownerId,
              status: { $ne: UserStatus.DEACTIVATED },
            })
            .session(session);
          if (target.visibility !== ItineraryVisibility.PUBLIC || !author)
            throw new NotFoundException('Content not found.');
        }
        await this.lock(dto.targetType, dto.targetId, session);
        await this.reports.create(
          [
            {
              _id: id,
              reporterId: user._id,
              targetModel: MODEL[dto.targetType],
              targetId: target._id,
              reason: dto.reason,
            },
          ],
          { session },
        );
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException('You have already reported this item.');
      throw error;
    }
    return this.present(
      await this.reports.findById(id).lean<StoredReport>().orFail().exec(),
    );
  }

  async list(query: ReportsQueryDto): Promise<ReportListDto> {
    const filter = { status: query.status ?? ReportStatus.OPEN };
    const [items, total] = await Promise.all([
      this.reports
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean<StoredReport[]>()
        .exec(),
      this.reports.countDocuments(filter).exec(),
    ]);
    return {
      ...pageInfo(query.page, total),
      items: items.map((item) => this.present(item)),
    };
  }

  async read(
    type: ContentType,
    id: string,
    owner?: UserDocument,
  ): Promise<ModeratedContentDto> {
    const content = await this.target(type, id);
    if (
      owner &&
      (content.authorId ?? content.ownerId)?.toString() !== owner._id.toString()
    )
      throw new NotFoundException('Content not found.');
    const { __v: _version, ...safeContent } = content;
    return { type, content: safeContent };
  }

  async resolve(
    user: UserDocument,
    id: string,
    action: ReportResolution,
  ): Promise<ReportDto> {
    let urls: string[] = [];
    await this.db.transaction(async (session) => {
      urls = [];
      const report = Types.ObjectId.isValid(id)
        ? await this.reports.findById(id).session(session).exec()
        : null;
      if (!report) throw new NotFoundException('Report not found.');
      if (report.status !== ReportStatus.OPEN)
        throw new ConflictException('Report is already resolved.');
      if (action === ReportResolution.DISMISS) {
        await this.reports
          .updateOne(
            { _id: report._id, status: ReportStatus.OPEN },
            {
              $set: {
                status: ReportStatus.DISMISSED,
                resolvedById: user._id,
                resolvedAt: new Date(),
              },
            },
            { session },
          )
          .exec();
        await this.audit.create(
          [
            {
              actorId: user._id,
              action: AuditAction.REPORT_DISMISSED,
              targetModel: Report.name,
              targetId: report._id,
              reportId: report._id,
            },
          ],
          { session },
        );
      } else {
        const type = this.typeFor(report.targetModel);
        urls = await this.apply(
          user,
          type,
          report.targetId.toString(),
          action,
          session,
          report._id,
        );
      }
    });
    await Promise.all(urls.map((url) => this.uploads.remove(url)));
    return this.present(
      await this.reports.findById(id).lean<StoredReport>().orFail().exec(),
    );
  }

  async moderate(
    user: UserDocument,
    type: ContentType,
    id: string,
    action: ReportResolution.HIDE | ReportResolution.DELETE,
  ): Promise<void> {
    let urls: string[] = [];
    await this.db.transaction(async (session) => {
      urls = await this.apply(user, type, id, action, session);
    });
    await Promise.all(urls.map((url) => this.uploads.remove(url)));
  }

  private async apply(
    user: UserDocument,
    type: ContentType,
    id: string,
    action: ReportResolution.HIDE | ReportResolution.DELETE,
    session: ClientSession,
    reportId?: Types.ObjectId,
  ): Promise<string[]> {
    const target = await this.lock(type, id, session);
    const now = new Date();
    const targets: {
      targetModel: string;
      targetId: Types.ObjectId | { $in: Types.ObjectId[] };
    }[] = [{ targetModel: MODEL[type], targetId: target._id }];
    let urls: string[] = [];
    if (action === ReportResolution.HIDE) {
      await this.model(type)
        .updateOne(
          { _id: target._id },
          { $set: { hiddenAt: target.hiddenAt ?? now } },
          { session },
        )
        .exec();
    } else {
      if (type === ContentType.POST) {
        const children = await this.comments
          .find({ postId: target._id })
          .select('_id')
          .session(session)
          .lean()
          .exec();
        targets.push({
          targetModel: Comment.name,
          targetId: { $in: children.map((item) => item._id) },
        });
        await this.comments
          .deleteMany({ postId: target._id }, { session })
          .exec();
        await this.likes.deleteMany({ postId: target._id }, { session }).exec();
        urls = (target.images ?? []).map((image) => image.url);
      }
      if (type === ContentType.ITINERARY)
        urls = (target.days ?? []).flatMap((day) =>
          day.activities.flatMap((activity) =>
            activity.images.map((image) => image.url),
          ),
        );
      await this.model(type).deleteOne({ _id: target._id }, { session }).exec();
    }
    await this.reports
      .updateMany(
        { $or: targets, status: ReportStatus.OPEN },
        {
          $set: {
            status:
              action === ReportResolution.HIDE
                ? ReportStatus.CONTENT_HIDDEN
                : ReportStatus.CONTENT_DELETED,
            resolvedById: user._id,
            resolvedAt: now,
          },
        },
        { session },
      )
      .exec();
    // Repeated direct hides are idempotent; a report resolution still records its decision.
    if (
      action === ReportResolution.DELETE ||
      target.hiddenAt == null ||
      reportId
    )
      await this.audit.create(
        [
          {
            actorId: user._id,
            action:
              action === ReportResolution.HIDE
                ? AuditAction.CONTENT_HIDDEN
                : AuditAction.CONTENT_DELETED,
            targetModel: MODEL[type],
            targetId: target._id,
            reportId,
          },
        ],
        { session },
      );
    return urls;
  }

  private model(type: ContentType): Model<Content> {
    return this.db.model<Content>(MODEL[type]);
  }

  private async target(
    type: ContentType,
    id: string,
    session: ClientSession | null = null,
  ): Promise<Content> {
    const target = Types.ObjectId.isValid(id)
      ? await this.model(type)
          .findById(id)
          .session(session)
          .lean<Content>()
          .exec()
      : null;
    if (!target)
      throw new NotFoundException(
        'Content not found. If it was deleted, dismiss its report.',
      );
    return target;
  }

  private async lock(
    type: ContentType,
    id: string,
    session: ClientSession,
  ): Promise<Content> {
    const target = await this.target(type, id, session);
    if (
      type === ContentType.COMMENT &&
      target.postId &&
      (await this.model(ContentType.POST)
        .exists({ _id: target.postId })
        .session(session))
    )
      await this.visibility.lock(target.postId.toString(), session, false);
    // Incrementing the version conflicts with owner saves and concurrent deletion.
    await this.model(type)
      .updateOne(
        { _id: target._id },
        { $inc: { __v: 1 } },
        { session, timestamps: false },
      )
      .exec();
    return target;
  }

  private typeFor(model: string): ContentType {
    const type = (Object.keys(MODEL) as ContentType[]).find(
      (key) => MODEL[key] === model,
    );
    if (!type) throw new NotFoundException('Content type not supported.');
    return type;
  }

  private present(report: StoredReport): ReportDto {
    return {
      id: report._id.toString(),
      reporterId: report.reporterId.toString(),
      targetType: this.typeFor(report.targetModel),
      targetId: report.targetId.toString(),
      reason: report.reason,
      status: report.status,
      createdAt: report.createdAt,
      resolvedById: report.resolvedById?.toString(),
      resolvedAt: report.resolvedAt,
    };
  }
}
