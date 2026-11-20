import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { assertOwnedBy } from '../auth/access';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { BookingTargets, TYPE_FOR } from './booking-targets';
import { RefundDto } from './dto/payment.dto';
import { Payment, PaymentStatus } from './schemas/payment.schema';
import { Refund, RefundStatus } from './schemas/refund.schema';
import { RefundState, StripeGateway } from './stripe-gateway';

/** Stripe refund states → ours: succeeded is refunded; failed or canceled is failed. */
export function refundStatusOf(state: RefundState): RefundStatus {
  if (state.status === 'succeeded') return RefundStatus.REFUNDED;
  if (state.status === 'failed' || state.status === 'canceled')
    return RefundStatus.FAILED;
  return RefundStatus.PENDING;
}

type StoredRefund = Refund & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * PAY-03: every pending refund (traveler cancellations by tier, provider
 * cancellations at 100%, and payments that arrived after a hold ended) is
 * sent through the Stripe Refunds API, tracked as Pending, Refunded or
 * Failed, and the traveler is notified when it finishes.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    private readonly targets: BookingTargets,
    private readonly stripe: StripeGateway,
  ) {}

  /** Sends new refunds to Stripe and checks on ones still pending there. */
  async dispatchPending(): Promise<void> {
    // A bounded first page can permanently starve later refunds behind ones
    // that stay pending remotely. Stream all pending rows in stable id order.
    const pending = this.refunds
      .find({ status: RefundStatus.PENDING })
      .sort({ _id: 1 })
      .cursor({ batchSize: 100 });
    for await (const refund of pending) {
      try {
        await this.sync(refund);
      } catch {
        this.logger.error(`Could not process refund ${refund.id} with Stripe.`);
      }
    }
  }

  /** GET /api/refunds/:id for the booking's owner, with a fresh status. */
  async findOwn(user: UserDocument, id: string): Promise<RefundDto> {
    const refund = Types.ObjectId.isValid(id)
      ? await this.refunds.findById(id).exec()
      : null;
    const payment = refund
      ? await this.payments.findById(refund.paymentId).lean().exec()
      : null;
    const booking = payment
      ? await this.targets.find(payment.bookingModel, payment.bookingId)
      : null;
    if (!refund || !payment || !booking)
      throw new NotFoundException('Refund not found.');
    assertOwnedBy(user, booking.userId, 'Refund not found.');
    if (refund.status === RefundStatus.PENDING) {
      try {
        await this.sync(refund);
      } catch {
        this.logger.warn(`Could not refresh refund ${refund.id} from Stripe.`);
      }
    }
    const fresh = (await this.refunds
      .findById(refund._id)
      .lean()
      .exec()) as unknown as StoredRefund;
    return {
      id: fresh._id.toString(),
      paymentId: payment._id.toString(),
      bookingType: TYPE_FOR[payment.bookingModel],
      bookingId: payment.bookingId.toString(),
      amountMinorUnits: fresh.amountMinorUnits,
      currency: fresh.currency,
      status: fresh.status,
      createdAt: fresh.createdAt,
      updatedAt: fresh.updatedAt,
    };
  }

  /** Applies a refund state from Stripe (webhook or polling). */
  async applyStripeRefund(state: RefundState): Promise<void> {
    const refund = await this.refunds
      .findOne({ stripeRefundId: state.id })
      .exec();
    if (refund) await this.record(refund, state);
  }

  /**
   * The refund for a booking's successful payment, for the booking details
   * pages (PAY-03: status shown on the booking).
   */
  async forBooking(
    bookingModel: 'FlightBooking' | 'HotelBooking',
    bookingId: Types.ObjectId,
  ) {
    const payment = await this.payments
      .findOne({ bookingModel, bookingId, status: PaymentStatus.SUCCEEDED })
      .select('_id')
      .lean()
      .exec();
    if (!payment) return undefined;
    const refund = await this.refunds
      .findOne({ paymentId: payment._id })
      .lean()
      .exec();
    return refund
      ? {
          id: refund._id.toString(),
          amountMinorUnits: refund.amountMinorUnits,
          currency: refund.currency,
          status: refund.status,
        }
      : undefined;
  }

  private async sync(refund: Refund & { _id: Types.ObjectId; id?: string }) {
    if (refund.stripeRefundId) {
      await this.record(
        refund,
        await this.stripe.retrieveRefund(refund.stripeRefundId),
      );
      return;
    }
    const payment = await this.payments
      .findById(refund.paymentId)
      .lean()
      .exec();
    if (!payment) return;
    const state = await this.stripe.createRefund({
      paymentIntentId: payment.stripePaymentIntentId,
      amountMinorUnits: refund.amountMinorUnits,
      metadata: {
        refundId: refund._id.toString(),
        bookingModel: payment.bookingModel,
        bookingId: payment.bookingId.toString(),
      },
      // The same key on a retry returns the same Stripe refund, never a second one.
      idempotencyKey: `refund-${refund._id.toString()}`,
    });
    await this.record(refund, state);
  }

  /** Saves the Stripe id and status, and notifies once it is final. */
  private async record(
    refund: Refund & { _id: Types.ObjectId },
    state: RefundState,
  ): Promise<void> {
    const status = refundStatusOf(state);
    // A final state and its notification commit together. A failed write leaves
    // the refund pending, so webhook delivery or polling can retry safely.
    // Stripe requests happen before this transaction, using the same idempotency key.
    await this.connection.transaction(async (session) => {
      const updated = await this.refunds
        .findOneAndUpdate(
          // A finished refund never changes again.
          { _id: refund._id, status: RefundStatus.PENDING },
          { $set: { stripeRefundId: state.id, status } },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated || status === RefundStatus.PENDING) return;

      const payment = await this.payments
        .findById(updated.paymentId)
        .session(session)
        .lean()
        .exec();
      const booking = payment
        ? await this.targets.find(
            payment.bookingModel,
            payment.bookingId,
            session,
          )
        : null;
      if (!booking) return;
      const amount = `${updated.amountMinorUnits} ${updated.currency} minor units`;
      await this.notifications
        .updateOne(
          {
            recipientId: booking.userId,
            eventKey: `refund:${updated.id}:${status}`,
          },
          {
            $setOnInsert: {
              type: NotificationType.REFUND_UPDATED,
              subjectModel: Refund.name,
              subjectId: updated._id,
              title:
                status === RefundStatus.REFUNDED
                  ? 'Refund completed'
                  : 'Refund failed',
              message:
                status === RefundStatus.REFUNDED
                  ? `Your refund of ${amount}${booking.reference ? ` for booking ${booking.reference}` : ''} was sent to your card.`
                  : `Your refund of ${amount}${booking.reference ? ` for booking ${booking.reference}` : ''} could not be completed${state.failureReason ? ` (${state.failureReason})` : ''}. Our team will follow up.`,
            },
          },
          { upsert: true, session },
        )
        .exec();
    });
  }
}
