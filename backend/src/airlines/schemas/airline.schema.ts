import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
class ExtraBaggagePolicy {
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
class CancellationTier {
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  daysBeforeDeparture: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercentage: number;
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

  @Prop({ type: SchemaFactory.createForClass(ExtraBaggagePolicy) })
  extraBaggagePolicy?: ExtraBaggagePolicy;

  @Prop({
    type: [SchemaFactory.createForClass(CancellationTier)],
    required: true,
    default: [],
    castNonArrays: false,
    validate: {
      validator: (tiers: (CancellationTier | null)[]) => {
        const thresholds = new Set(
          tiers.map((tier) => tier?.daysBeforeDeparture),
        );
        return !thresholds.has(undefined) && thresholds.size === tiers.length;
      },
      message:
        'Cancellation tiers must each have a distinct days-before-departure threshold.',
    },
  })
  cancellationTiers: CancellationTier[];
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
