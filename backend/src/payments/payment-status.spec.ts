import { PaymentStatus } from './schemas/payment.schema';
import { RefundStatus } from './schemas/refund.schema';
import { paymentStatusOf } from './payments.service';
import { refundStatusOf } from './refunds.service';
import type { IntentState } from './stripe-gateway';

const intent = (status: IntentState['status'], failureMessage?: string) =>
  ({
    id: 'pi_1',
    status,
    amount: 1,
    currency: 'egp',
    clientSecret: null,
    failureMessage,
  }) as IntentState;

describe('Stripe status mapping', () => {
  it.each([
    [intent('succeeded'), PaymentStatus.SUCCEEDED],
    [intent('canceled'), PaymentStatus.CANCELLED],
    [
      intent('requires_payment_method', 'Your card was declined.'),
      PaymentStatus.FAILED,
    ],
    [intent('requires_payment_method'), PaymentStatus.PENDING],
    [intent('processing'), PaymentStatus.PENDING],
    [intent('requires_action'), PaymentStatus.PENDING],
  ])('maps a PaymentIntent %#', (state, expected) => {
    expect(paymentStatusOf(state)).toBe(expected);
  });

  it.each([
    ['succeeded', RefundStatus.REFUNDED],
    ['pending', RefundStatus.PENDING],
    ['requires_action', RefundStatus.PENDING],
    ['failed', RefundStatus.FAILED],
    ['canceled', RefundStatus.FAILED],
  ])('maps a Stripe refund that is %s', (status, expected) => {
    expect(refundStatusOf({ id: 're_1', status })).toBe(expected);
  });
});
