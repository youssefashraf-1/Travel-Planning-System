import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class ExtraBaggagePolicy {
  @Prop({
    required: true,
    min: 1,
    validate: Number.isSafeInteger,
  })
  pricePerBagMinorUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  maxExtraBagsPerPassenger: number;
}

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  daysBeforeDeparture: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercentage: number;
}

export const ExtraBaggagePolicySchema =
  SchemaFactory.createForClass(ExtraBaggagePolicy);
export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

export function hasDistinctCancellationThresholds(
  tiers: (CancellationTier | null)[],
): boolean {
  const thresholds = new Set(tiers.map((tier) => tier?.daysBeforeDeparture));
  return !thresholds.has(undefined) && thresholds.size === tiers.length;
}

@Schema({ timestamps: true })
export class Airline {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, uppercase: true, unique: true })
  code: string;

  @Prop({ trim: true })
  logoUrl?: string;

  @Prop({ required: true, default: true })
  isActive: boolean;

  @Prop({ type: ExtraBaggagePolicySchema })
  extraBaggagePolicy?: ExtraBaggagePolicy;

  @Prop({
    type: [CancellationTierSchema],
    required: true,
    default: [],
    castNonArrays: false,
    validate: {
      validator: hasDistinctCancellationThresholds,
      message:
        'Cancellation tiers must each have a distinct days-before-departure threshold.',
    },
  })
  cancellationTiers: CancellationTier[];
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
