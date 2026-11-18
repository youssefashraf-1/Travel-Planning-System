import { model, Types } from 'mongoose';
import { AuditAction, AuditLog, AuditLogSchema } from './audit-log.schema';

const AuditLogModel = model(AuditLog.name, AuditLogSchema);

describe('Audit log', () => {
  it('rejects a content deletion recorded against an account', async () => {
    const entry = new AuditLogModel({
      actorId: new Types.ObjectId(),
      action: AuditAction.CONTENT_DELETED,
      targetModel: 'User',
      targetId: new Types.ObjectId(),
    });

    await expect(entry.validate()).rejects.toMatchObject({
      errors: { targetModel: expect.any(Error) },
    });
  });

  it('keeps the action and target on a loaded record unchanged', async () => {
    const targetId = new Types.ObjectId();
    const entry = AuditLogModel.hydrate({
      _id: new Types.ObjectId(),
      actorId: new Types.ObjectId(),
      action: AuditAction.CONTENT_DELETED,
      targetModel: 'Comment',
      targetId,
    });

    entry.action = AuditAction.CONTENT_HIDDEN;
    entry.targetId = new Types.ObjectId();

    expect(entry.action).toBe(AuditAction.CONTENT_DELETED);
    expect(entry.targetId?.equals(targetId)).toBe(true);
    await expect(entry.validate()).resolves.toBeUndefined();
  });
});
