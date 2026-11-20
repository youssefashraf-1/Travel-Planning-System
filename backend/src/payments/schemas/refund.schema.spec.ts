import { model, Types } from 'mongoose';
import { Refund, RefundSchema, RefundStatus } from './refund.schema';

const RefundModel = model(Refund.name, RefundSchema);

describe('Cancellation refund', () => {
  it('can await Stripe but cannot be marked refunded without a Stripe refund ID', async () => {
    const refund = new RefundModel({
      paymentId: new Types.ObjectId(),
      amountMinorUnits: 1200,
      currency: 'EGP',
    });

    await expect(refund.validate()).resolves.toBeUndefined();
    refund.status = RefundStatus.REFUNDED;
    await expect(refund.validate()).rejects.toMatchObject({
      errors: { stripeRefundId: expect.any(Error) },
    });
  });
});
