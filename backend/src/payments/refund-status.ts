import { RefundStatus } from './schemas/refund.schema';
import type { RefundState } from './stripe-gateway';

/** Stripe refund states → ours: succeeded is refunded; failed or canceled is failed. */
export function refundStatusOf(state: RefundState): RefundStatus {
  if (state.status === 'succeeded') return RefundStatus.REFUNDED;
  if (state.status === 'failed' || state.status === 'canceled')
    return RefundStatus.FAILED;
  return RefundStatus.PENDING;
}
