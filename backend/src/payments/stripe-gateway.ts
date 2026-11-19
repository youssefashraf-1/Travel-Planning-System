import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** The parts of a Stripe PaymentIntent the backend uses (PAY-01). */
export interface IntentState {
  id: string;
  status: Stripe.PaymentIntent.Status;
  amount: number;
  currency: string;
  clientSecret: string | null;
  failureMessage?: string;
}

/** The parts of a Stripe Refund the backend uses (PAY-03). */
export interface RefundState {
  id: string;
  status: string | null;
  failureReason?: string;
}

/** Stripe's test card tokens, for example pm_card_visa. Test mode only. */
export const TEST_PAYMENT_METHOD = /^pm_card_[A-Za-z0-9_]+$/;

function intentState(intent: Stripe.PaymentIntent): IntentState {
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    clientSecret: intent.client_secret,
    failureMessage: intent.last_payment_error?.message,
  };
}

function refundState(refund: Stripe.Refund): RefundState {
  return {
    id: refund.id,
    status: refund.status,
    failureReason: refund.failure_reason ?? undefined,
  };
}

/**
 * Every call to Stripe goes through here. Keys come from backend/.env:
 * STRIPE_SECRET_KEY (sk_test_...) and STRIPE_WEBHOOK_SECRET (whsec_...).
 * They are read when used, so the rest of the backend runs without them.
 * Card details never reach this server: the frontend sends them to Stripe
 * with the client secret (Stripe Elements).
 */
@Injectable()
export class StripeGateway {
  private client?: Stripe;
  private readonly logger = new Logger(StripeGateway.name);

  constructor(private readonly config: ConfigService) {}

  isTestMode(): boolean {
    return this.secretKey().startsWith('sk_test_');
  }

  async createIntent(input: {
    amountMinorUnits: number;
    currency: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<IntentState> {
    const intent = await this.stripe().paymentIntents.create(
      {
        amount: input.amountMinorUnits,
        currency: input.currency.toLowerCase(),
        metadata: input.metadata,
        // Card payments confirmed on the page, without redirects.
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return intentState(intent);
  }

  async retrieveIntent(id: string): Promise<IntentState> {
    return intentState(await this.stripe().paymentIntents.retrieve(id));
  }

  /**
   * Test mode only: pays with one of Stripe's test card tokens, so the
   * flow can be tried in Swagger before the frontend exists. A declined
   * card is not an error here; the returned state says it failed.
   */
  async confirmWithTestMethod(
    id: string,
    paymentMethod: string,
  ): Promise<IntentState> {
    if (!this.isTestMode())
      throw new BadRequestException(
        'testPaymentMethod only works with a Stripe test key.',
      );
    if (!TEST_PAYMENT_METHOD.test(paymentMethod))
      throw new BadRequestException(
        'testPaymentMethod must be a Stripe test token such as pm_card_visa.',
      );
    try {
      return intentState(
        await this.stripe().paymentIntents.confirm(id, {
          payment_method: paymentMethod,
        }),
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError)
        return this.retrieveIntent(id);
      throw error;
    }
  }

  /** PAY-01: an expired hold's PaymentIntent is cancelled. */
  async cancelIntent(id: string): Promise<IntentState> {
    try {
      return intentState(await this.stripe().paymentIntents.cancel(id));
    } catch (error) {
      // Already succeeded or cancelled: report its real state instead.
      if (error instanceof Stripe.errors.StripeInvalidRequestError)
        return this.retrieveIntent(id);
      throw error;
    }
  }

  /** PAY-03: the idempotency key makes a retried refund safe. */
  async createRefund(input: {
    paymentIntentId: string;
    amountMinorUnits: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundState> {
    const refund = await this.stripe().refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountMinorUnits,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return refundState(refund);
  }

  async retrieveRefund(id: string): Promise<RefundState> {
    return refundState(await this.stripe().refunds.retrieve(id));
  }

  /** Checks the Stripe-Signature header against the raw request body. */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!secret)
      throw new ServiceUnavailableException(
        'Stripe webhooks are not configured on this server (STRIPE_WEBHOOK_SECRET).',
      );
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature.');
    }
  }

  private secretKey(): string {
    return this.config.get<string>('STRIPE_SECRET_KEY')?.trim() ?? '';
  }

  private stripe(): Stripe {
    if (!this.client) {
      const key = this.secretKey();
      if (!key) {
        this.logger.error('STRIPE_SECRET_KEY is not set in backend/.env.');
        throw new ServiceUnavailableException(
          'Payments are not configured on this server.',
        );
      }
      this.client = new Stripe(key, { maxNetworkRetries: 2 });
    }
    return this.client;
  }
}
