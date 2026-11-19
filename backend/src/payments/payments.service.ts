import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingStatus } from '../common/booking-status';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { UserDocument } from '../users/schemas/user.schema';
import {
  BookingModelName,
  BookingTargets,
  MODEL_FOR,
  PayableBooking,
  TYPE_FOR,
} from './booking-targets';
import {
  BookingPoliciesDto,
  BookingType,
  CreatePaymentDto,
  PaymentDto,
  RetryPaymentDto,
} from './dto/payment.dto';
import { RefundsService } from './refunds.service';
import { Payment, PaymentStatus } from './schemas/payment.schema';
import { Refund, RefundStatus } from './schemas/refund.schema';
import { IntentState, StripeGateway } from './stripe-gateway';

type PaymentDoc = Payment & { _id: Types.ObjectId };

/** Stripe PaymentIntent states → ours (PAY-01). */
export function paymentStatusOf(intent: IntentState): PaymentStatus {
  if (intent.status === 'succeeded') return PaymentStatus.SUCCEEDED;
  if (intent.status === 'canceled') return PaymentStatus.CANCELLED;
  // A declined card returns the intent to "requires_payment_method" with an error.
  if (intent.status === 'requires_payment_method' && intent.failureMessage)
    return PaymentStatus.FAILED;
  return PaymentStatus.PENDING;
}

/** Statuses a payment can still move on from. */
const OPEN = [PaymentStatus.PENDING, PaymentStatus.FAILED];

/**
 * PAY-01, PAY-02: policies, Stripe payments, retries and confirmation.
 * A booking is confirmed only after Stripe reports the PaymentIntent
 * succeeded: through the signed webhook, or by asking Stripe directly.
 * Only the Stripe id, amount, currency and status are stored.
 */
@Injectable()
export class PaymentsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    private readonly targets: BookingTargets,
    private readonly stripe: StripeGateway,
    private readonly refundsService: RefundsService,
  ) {}

  /** PAY-02: the provider policies the traveler must accept before paying. */
  async policies(
    user: UserDocument,
    type: BookingType,
    id: string,
  ): Promise<BookingPoliciesDto> {
    const name = MODEL_FOR[type];
    await this.targets.findOwn(user, name, id);
    const booking =
      name === 'FlightBooking'
        ? await this.flightBookings.findById(id).lean().exec()
        : await this.hotelBookings.findById(id).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');

    const policies =
      'segments' in booking
        ? booking.segments.map((segment, index) => ({
            leg: index === 0 ? 'outbound' : 'return',
            flightId: segment.flightId.toString(),
            cabinClass: segment.cabinClass,
            freeBaggage: {
              bags: segment.freeBagCount,
              maxWeightKgPerBag: segment.maxBagWeightKg,
            },
            extraBaggage: segment.extraBaggagePolicy
              ? {
                  pricePerBagMinorUnits:
                    segment.extraBaggagePolicy.pricePerBagMinorUnits,
                  maxExtraBagsPerPassenger:
                    segment.extraBaggagePolicy.maxExtraBagsPerPassenger,
                }
              : null,
            cancellationTiers: segment.cancellationTiers.map((tier) => ({
              daysBeforeDeparture: tier.daysBeforeDeparture,
              refundPercentage: tier.refundPercentage,
            })),
            cancellationRule:
              'Cancel any time before the outbound flight departs. The tier ' +
              'with the highest threshold not above the whole days left ' +
              'decides the refund of the full total; no tier means no refund.',
          }))
        : [
            {
              checkInTime: booking.policy.checkInTime,
              checkOutTime: booking.policy.checkOutTime,
              timeZone: booking.timeZone,
              cancellationTiers: booking.policy.cancellationTiers.map(
                (tier) => ({
                  daysBeforeCheckIn: tier.daysBeforeCheckIn,
                  refundPercentage: tier.refundPercentage,
                }),
              ),
              cancellationRule:
                'Cancel the whole reservation before the check-in date. The ' +
                'tier with the highest threshold not above the whole days ' +
                'left decides the refund of the full total; no tier means ' +
                'no refund.',
            },
          ];
    return {
      bookingType: type,
      bookingId: booking._id.toString(),
      bookingStatus: booking.status,
      policies,
      policyAcceptedAt: booking.policyAcceptedAt,
      totalMinorUnits: booking.totalMinorUnits,
      currency: booking.currency,
    };
  }

  /** PAY-02: stores the acceptance time while the hold lasts. */
  async acceptPolicies(
    user: UserDocument,
    type: BookingType,
    id: string,
    now = new Date(),
  ): Promise<BookingPoliciesDto> {
    const name = MODEL_FOR[type];
    const booking = await this.targets.findOwn(user, name, id);
    this.assertPayable(booking, now);
    if (!booking.policyAcceptedAt)
      await this.targets.acceptPolicies(name, booking._id, now);
    return this.policies(user, type, id);
  }

  /**
   * PAY-01: creates the Stripe PaymentIntent for the booking total. The
   * frontend pays with the client secret (Stripe Elements); in test mode
   * a test card token can pay here directly.
   */
  async create(
    user: UserDocument,
    dto: CreatePaymentDto,
    now = new Date(),
  ): Promise<PaymentDto> {
    const name = MODEL_FOR[dto.bookingType];
    const booking = await this.targets.findOwn(user, name, dto.bookingId);
    this.assertPayable(booking, now);
    if (!booking.policyAcceptedAt)
      throw new ConflictException(
        `Accept the booking policies first: POST /api/bookings/${dto.bookingType}/${dto.bookingId}/accept-policies (PAY-02).`,
      );
    const existing = await this.payments
      .findOne({
        bookingModel: name,
        bookingId: booking._id,
        status: { $in: OPEN },
      })
      .lean()
      .exec();
    if (existing)
      throw new ConflictException(
        `This booking already has a payment in progress. Retry it with POST /api/payments/${existing._id.toString()}/retry.`,
      );

    const attempt = await this.payments
      .countDocuments({ bookingModel: name, bookingId: booking._id })
      .exec();
    const intent = await this.stripe.createIntent({
      amountMinorUnits: booking.totalMinorUnits,
      currency: booking.currency,
      metadata: { bookingModel: name, bookingId: booking._id.toString() },
      idempotencyKey: `payment-${name}-${booking._id.toString()}-${attempt}`,
    });
    const payment = await this.payments.create({
      bookingModel: name,
      bookingId: booking._id,
      stripePaymentIntentId: intent.id,
      amountMinorUnits: intent.amount,
      currency: intent.currency.toUpperCase(),
      status: PaymentStatus.PENDING,
    });
    return this.afterIntent(payment.toObject(), intent, dto.testPaymentMethod);
  }

  /** PAY-01: try again after a declined card, while the hold lasts. */
  async retry(
    user: UserDocument,
    id: string,
    dto: RetryPaymentDto,
    now = new Date(),
  ): Promise<PaymentDto> {
    const { payment, booking } = await this.findOwnPayment(user, id);
    await this.refresh(payment, now);
    const current = (await this.payments.findById(payment._id).lean().exec())!;
    if (current.status === PaymentStatus.SUCCEEDED)
      throw new ConflictException('This payment has already succeeded.');
    if (current.status === PaymentStatus.CANCELLED)
      throw new ConflictException(
        'This payment was cancelled because the hold ended. Book again.',
      );
    this.assertPayable(booking, now);
    const intent = await this.stripe.retrieveIntent(
      current.stripePaymentIntentId,
    );
    await this.payments
      .updateOne(
        { _id: current._id, status: PaymentStatus.FAILED },
        { $set: { status: PaymentStatus.PENDING } },
      )
      .exec();
    return this.afterIntent(
      Object.assign({}, current, { status: PaymentStatus.PENDING }),
      intent,
      dto.testPaymentMethod,
    );
  }

  /** GET /api/payments/:id: the latest status, checked with Stripe. */
  async findOwn(user: UserDocument, id: string, now = new Date()) {
    const { payment } = await this.findOwnPayment(user, id);
    await this.refresh(payment, now);
    return this.present(payment._id);
  }

  /** POST /api/payments/webhook: Stripe's signed event. */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!rawBody || !signature)
      throw new HttpException(
        'Missing Stripe signature or body.',
        HttpStatus.BAD_REQUEST,
      );
    const event = this.stripe.constructWebhookEvent(rawBody, signature);
    await this.handleEvent(event);
    return { received: true };
  }

  async handleEvent(event: Stripe.Event, now = new Date()): Promise<void> {
    if (event.type.startsWith('payment_intent.')) {
      const object = event.data.object as Stripe.PaymentIntent;
      const payment = await this.payments
        .findOne({ stripePaymentIntentId: object.id })
        .lean()
        .exec();
      if (payment)
        await this.applyIntent(
          payment,
          {
            id: object.id,
            status: object.status,
            amount: object.amount,
            currency: object.currency,
            clientSecret: null,
            failureMessage: object.last_payment_error?.message,
          },
          now,
        );
    } else if (event.type.startsWith('refund.')) {
      const refund = event.data.object as Stripe.Refund;
      await this.refundsService.applyStripeRefund({
        id: refund.id,
        status: refund.status,
        failureReason: refund.failure_reason ?? undefined,
      });
    }
  }

  /**
   * Records what Stripe says. Success confirms the booking in the same
   * transaction as the payment. If the booking can no longer be confirmed
   * (the hold expired or it was cancelled), the money is refunded in full.
   * Running it twice for the same success changes nothing.
   */
  async applyIntent(
    payment: PaymentDoc,
    intent: IntentState,
    now = new Date(),
  ): Promise<void> {
    const status = paymentStatusOf(intent);
    if (status !== PaymentStatus.SUCCEEDED) {
      await this.payments
        .updateOne(
          { _id: payment._id, status: { $ne: PaymentStatus.SUCCEEDED } },
          { $set: { status } },
        )
        .exec();
      return;
    }
    try {
      await this.connection.transaction(async (session) => {
        const changed = await this.payments
          .updateOne(
            { _id: payment._id, status: { $ne: PaymentStatus.SUCCEEDED } },
            { $set: { status: PaymentStatus.SUCCEEDED } },
            { session },
          )
          .exec();
        if (changed.modifiedCount !== 1) return;
        await this.targets.confirm(payment.bookingModel, payment.bookingId, {
          session,
          now,
        });
      });
    } catch (error) {
      if (
        !(error instanceof ConflictException) &&
        !(error instanceof NotFoundException)
      )
        throw error;
      await this.refundLateSuccess(payment);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Every 30 seconds: cancel the Stripe PaymentIntent of any hold that
   * ended (PAY-01), then send pending refunds to Stripe (PAY-03).
   */
  async sweep(now = new Date()): Promise<void> {
    try {
      const open = await this.payments
        .find({ status: { $in: OPEN } })
        .limit(100)
        .lean()
        .exec();
      for (const payment of open) {
        const booking = await this.targets.find(
          payment.bookingModel,
          payment.bookingId,
        );
        if (booking && this.isPayable(booking, now)) continue;
        try {
          await this.applyIntent(
            payment,
            await this.stripe.cancelIntent(payment.stripePaymentIntentId),
            now,
          );
        } catch {
          this.logger.error(
            `Could not cancel payment ${payment._id.toString()}.`,
          );
        }
      }
      await this.refundsService.dispatchPending();
    } catch {
      this.logger.error('Unable to process payments and refunds.');
    }
  }

  private async refundLateSuccess(payment: PaymentDoc): Promise<void> {
    try {
      await this.payments
        .updateOne(
          { _id: payment._id, status: { $ne: PaymentStatus.SUCCEEDED } },
          { $set: { status: PaymentStatus.SUCCEEDED } },
        )
        .exec();
    } catch (error) {
      // Another payment already succeeded for this booking: keep this one's
      // status, and still refund it below.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    if (await this.refunds.exists({ paymentId: payment._id })) return;
    await this.refunds.create({
      paymentId: payment._id,
      amountMinorUnits: payment.amountMinorUnits,
      currency: payment.currency,
      status: RefundStatus.PENDING,
    });
    this.logger.warn(
      `Payment ${payment._id.toString()} succeeded after its booking could no longer be confirmed; a full refund was queued.`,
    );
    await this.refundsService.dispatchPending();
  }

  private async afterIntent(
    payment: PaymentDoc,
    intent: IntentState,
    testPaymentMethod: string | undefined,
  ): Promise<PaymentDto> {
    let state = intent;
    if (testPaymentMethod) {
      state = await this.stripe.confirmWithTestMethod(
        intent.id,
        testPaymentMethod,
      );
      await this.applyIntent(payment, state);
    }
    const result = await this.present(
      payment._id,
      intent.clientSecret ?? undefined,
    );
    if (result.status === PaymentStatus.FAILED)
      // PAY-01: show the error; the traveler may retry while the hold lasts.
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Payment Required',
          message: `${state.failureMessage ?? 'The payment failed.'} Retry with POST /api/payments/${result.id}/retry before the hold expires.`,
          paymentId: result.id,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    return result;
  }

  private async refresh(payment: PaymentDoc, now: Date) {
    if (
      payment.status === PaymentStatus.SUCCEEDED ||
      payment.status === PaymentStatus.CANCELLED
    )
      return;
    try {
      await this.applyIntent(
        payment,
        await this.stripe.retrieveIntent(payment.stripePaymentIntentId),
        now,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Could not refresh payment ${payment._id.toString()} from Stripe.`,
      );
    }
  }

  private async present(
    paymentId: Types.ObjectId,
    clientSecret?: string,
  ): Promise<PaymentDto> {
    const payment = (await this.payments.findById(paymentId).lean().exec())!;
    const booking = (await this.targets.find(
      payment.bookingModel,
      payment.bookingId,
    ))!;
    return {
      id: payment._id.toString(),
      bookingType: TYPE_FOR[payment.bookingModel],
      bookingId: payment.bookingId.toString(),
      amountMinorUnits: payment.amountMinorUnits,
      currency: payment.currency,
      status: payment.status,
      clientSecret:
        clientSecret && OPEN.includes(payment.status)
          ? clientSecret
          : undefined,
      bookingStatus: booking.status,
      bookingReference: booking.reference,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  private async findOwnPayment(user: UserDocument, id: string) {
    const payment = Types.ObjectId.isValid(id)
      ? await this.payments.findById(id).lean().exec()
      : null;
    if (!payment) throw new NotFoundException('Payment not found.');
    try {
      const booking = await this.targets.findOwn(
        user,
        payment.bookingModel as BookingModelName,
        payment.bookingId.toString(),
      );
      return { payment, booking };
    } catch {
      throw new NotFoundException('Payment not found.');
    }
  }

  private isPayable(booking: PayableBooking, now: Date): boolean {
    return (
      booking.status === BookingStatus.PENDING_PAYMENT &&
      booking.holdExpiresAt > now
    );
  }

  private assertPayable(booking: PayableBooking, now: Date): void {
    if (booking.status !== BookingStatus.PENDING_PAYMENT)
      throw new ConflictException(
        `This booking is ${booking.status.replace('_', ' ')}, not waiting for payment.`,
      );
    if (booking.holdExpiresAt <= now)
      throw new ConflictException(
        'The hold has expired. Make a new booking to pay.',
      );
  }
}
