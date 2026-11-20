import { model, Types } from 'mongoose';
import { Report, ReportSchema, ReportStatus } from './report.schema';

const ReportModel = model(Report.name, ReportSchema);

const reportData = {
  reporterId: new Types.ObjectId(),
  targetModel: 'BlogPost',
  targetId: new Types.ObjectId(),
  reason: 'Example reason',
};

describe('Content report', () => {
  it('opens without resolution details and requires both details when resolved', async () => {
    const report = new ReportModel(reportData);
    expect(report.status).toBe(ReportStatus.OPEN);
    await expect(report.validate()).resolves.toBeUndefined();

    report.status = ReportStatus.CONTENT_HIDDEN;
    await expect(report.validate()).rejects.toMatchObject({
      errors: {
        resolvedById: expect.any(Error),
        resolvedAt: expect.any(Error),
      },
    });

    report.resolvedById = new Types.ObjectId();
    report.resolvedAt = new Date('2026-11-18T12:00:00Z');
    await expect(report.validate()).resolves.toBeUndefined();
  });

  it('rejects resolution metadata on an open report', async () => {
    const report = new ReportModel({
      ...reportData,
      resolvedAt: new Date('2026-11-18T12:00:00Z'),
    });

    await expect(report.validate()).rejects.toMatchObject({
      errors: { status: expect.any(Error) },
    });
  });
});
