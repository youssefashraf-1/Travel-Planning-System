import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { LOCAL_TIME_PATTERN } from '../../common/validation/local-time';

@Schema({ _id: false })
class HotelCancellationTier {
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  daysBeforeCheckIn: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercentage: number;
}

const HotelCancellationTierSchema = SchemaFactory.createForClass(
  HotelCancellationTier,
);

@Schema({ _id: false })
export class HotelPolicy {
  @Prop({ required: true, match: LOCAL_TIME_PATTERN })
  checkInTime: string;

  @Prop({ required: true, match: LOCAL_TIME_PATTERN })
  checkOutTime: string;

  @Prop({
    type: [HotelCancellationTierSchema],
    default: [],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (tiers: (HotelCancellationTier | null)[]) => {
        const thresholds = new Set(
          tiers.map((tier) => tier?.daysBeforeCheckIn),
        );
        return !thresholds.has(undefined) && thresholds.size === tiers.length;
      },
      message:
        'Hotel cancellation tiers must have distinct check-in thresholds.',
    },
  })
  cancellationTiers: HotelCancellationTier[];
}

export const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicy);
