import { ConflictException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/booking-status';
import {
  ChangeRefundStatus,
  FlightChange,
} from '../flight-bookings/schemas/flight-change.schema';
import { Payment, PaymentStatus } from './schemas/payment.schema';
import { Refund, RefundStatus } from './schemas/refund.schema';

export interface RefundPart {
  paymentId: Types.ObjectId;
  amountMinorUnits: number;
  currency: string;
}

/**
 * Splits a flight booking refund across the payments that paid for it.
 * After a flight change (FLT-27) a booking can have the original payment
 * plus fare-difference payments, and a lower fare may already have been
 * partly refunded. Each payment gives back at most what is still refundable
 * on it, newest payment first. Refunds are one per payment, so a payment
 * that already has a cancellation refund is skipped.
 */
export async function allocateFlightRefund(
  models: {
    payments: Model<Payment>;
    refunds: Model<Refund>;
    changes: Model<FlightChange>;
  },
  bookingId: Types.ObjectId,
  amountMinorUnits: number,
  session: ClientSession,
): Promise<RefundPart[]> {
  if (amountMinorUnits <= 0) return [];
  const changes = await models.changes
    .find({ bookingId })
    .session(session)
    .lean()
    .exec();
  const paidChanges = changes
    .filter((c) => c.status === BookingStatus.CONFIRMED)
    .map((c) => c._id);
  const payments = await models.payments
    .find({
      status: PaymentStatus.SUCCEEDED,
      $or: [
        { bookingModel: 'FlightBooking', bookingId },
        { bookingModel: 'FlightChange', bookingId: { $in: paidChanges } },
      ],
    })
    .sort({ createdAt: -1, _id: -1 })
    .session(session)
    .lean()
    .exec();
  if (payments.length === 0)
    throw new ConflictException(
      'No successful payment was found for this booking, so the refund cannot be recorded.',
    );
  const existing = await models.refunds
    .find({
      paymentId: { $in: payments.map((p) => p._id) },
      status: { $ne: RefundStatus.FAILED },
    })
    .session(session)
    .lean()
    .exec();
  const alreadyRefunded = new Set(existing.map((r) => r.paymentId.toString()));

  const parts: RefundPart[] = [];
  let remaining = amountMinorUnits;
  for (const payment of payments) {
    if (remaining <= 0) break;
    if (alreadyRefunded.has(payment._id.toString())) continue;
    // Lower-fare refunds from earlier changes came off this payment.
    const changeRefunds = changes
      .filter(
        (c) =>
          c.refundPaymentId?.equals(payment._id) &&
          c.refundStatus !== ChangeRefundStatus.FAILED,
      )
      .reduce((sum, c) => sum + c.refundMinorUnits, 0);
    const refundable = payment.amountMinorUnits - changeRefunds;
    if (refundable <= 0) continue;
    const amount = Math.min(refundable, remaining);
    parts.push({
      paymentId: payment._id,
      amountMinorUnits: amount,
      currency: payment.currency,
    });
    remaining -= amount;
  }
  if (remaining > 0)
    throw new ConflictException(
      'The booking payments do not cover this refund; it needs reconciliation.',
    );
  return parts;
}

/**
 * Records the parts as pending refunds for the payment service to send. A
 * payment whose earlier refund failed is retried with the new amount.
 */
export async function recordRefunds(
  refunds: Model<Refund>,
  parts: RefundPart[],
  session: ClientSession,
): Promise<number> {
  for (const part of parts) {
    const retried = await refunds
      .updateOne(
        { paymentId: part.paymentId, status: RefundStatus.FAILED },
        {
          $set: {
            amountMinorUnits: part.amountMinorUnits,
            currency: part.currency,
            status: RefundStatus.PENDING,
          },
          $unset: { stripeRefundId: 1 },
        },
        { session },
      )
      .exec();
    if (retried.matchedCount === 1) continue;
    await refunds.create(
      [
        {
          paymentId: part.paymentId,
          amountMinorUnits: part.amountMinorUnits,
          currency: part.currency,
          status: RefundStatus.PENDING,
        },
      ],
      { session },
    );
  }
  return parts.length;
}
