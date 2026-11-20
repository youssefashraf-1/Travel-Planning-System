import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Payment } from './payment.schema';
import { Currency } from '../../reference-data/schemas/currency.schema';

export enum RefundStatus {
  PENDING = 'pending',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class Refund {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Payment.name,
    required: true,
    unique: true,
  })
  paymentId: Types.ObjectId;

  @Prop({
    type: String,
    trim: true,
    required: function (this: Refund) {
      return this.status === RefundStatus.REFUNDED;
    },
  })
  stripeRefundId?: string;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  amountMinorUnits: number;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    ref: Currency.name,
  })
  currency: string;

  @Prop({
    type: String,
    enum: RefundStatus,
    required: true,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);

RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);
