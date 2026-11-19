import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsOptional,
  Matches,
} from 'class-validator';
import { BookingStatus } from '../../common/booking-status';
import { PaymentStatus } from '../schemas/payment.schema';
import { RefundStatus } from '../schemas/refund.schema';
import { TEST_PAYMENT_METHOD } from '../stripe-gateway';

/** Matches :type in /api/bookings/:type/:id. */
export enum BookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

const testMethod = {
  description:
    'Test mode only, for trying payments in Swagger before the frontend ' +
    'exists: a Stripe test card token. pm_card_visa succeeds; ' +
    'pm_card_chargeDeclined is declined. Without it, the frontend ' +
    'confirms the payment with Stripe Elements and the client secret.',
  example: 'pm_card_visa',
};

/** PAY-02: the acceptance checkbox. */
export class AcceptPoliciesDto {
  @ApiProperty({ example: true, description: 'Must be true.' })
  @IsBoolean()
  @Equals(true, { message: 'accept must be true to accept the policies' })
  accept: boolean;
}

/** PAY-01: pay for a Pending Payment booking within its hold. */
export class CreatePaymentDto {
  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({ example: '6740f0c2a1b2c3d4e5f60718' })
  @IsMongoId()
  bookingId: string;

  @ApiPropertyOptional(testMethod)
  @IsOptional()
  @Matches(TEST_PAYMENT_METHOD, {
    message:
      'testPaymentMethod must be a Stripe test token such as pm_card_visa',
  })
  testPaymentMethod?: string;
}

export class RetryPaymentDto {
  @ApiPropertyOptional(testMethod)
  @IsOptional()
  @Matches(TEST_PAYMENT_METHOD, {
    message:
      'testPaymentMethod must be a Stripe test token such as pm_card_visa',
  })
  testPaymentMethod?: string;
}

export class PaymentDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty({ example: 950000 }) amountMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    enum: PaymentStatus,
    description:
      'pending: waiting for the card. succeeded: Stripe confirmed it. ' +
      'failed: declined; retry while the hold lasts. cancelled: the hold ended.',
  })
  status: PaymentStatus;
  @ApiPropertyOptional({
    description:
      'For Stripe Elements on the frontend. Only returned when the payment ' +
      'is created or retried, and never stored.',
  })
  clientSecret?: string;
  @ApiPropertyOptional({ example: 'Your card was declined.' })
  failureMessage?: string;
  @ApiProperty({ enum: BookingStatus }) bookingStatus: BookingStatus;
  @ApiPropertyOptional({ example: 'K7Q2MX' }) bookingReference?: string;
  @ApiProperty({ type: String, format: 'date-time' }) holdExpiresAt: Date;
}

export class BookingPoliciesDto {
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty({ enum: BookingStatus }) bookingStatus: BookingStatus;
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Flights: one entry per flight with free baggage, extra baggage ' +
      'and cancellation tiers. Hotels: one entry with check-in and ' +
      'check-out times and cancellation tiers.',
  })
  policies: Record<string, unknown>[];
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'When the traveler accepted (PAY-02).',
  })
  policyAcceptedAt?: Date;
  @ApiProperty({ example: 950000 }) totalMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
}

export class RefundDto {
  @ApiProperty() id: string;
  @ApiProperty() paymentId: string;
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty({ example: 475000 }) amountMinorUnits: number;
  @ApiProperty({ example: 'EGP' }) currency: string;
  @ApiProperty({
    enum: RefundStatus,
    description:
      'pending: recorded or sent to Stripe. refunded: Stripe completed ' +
      'it. failed: Stripe could not refund it.',
  })
  status: RefundStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
