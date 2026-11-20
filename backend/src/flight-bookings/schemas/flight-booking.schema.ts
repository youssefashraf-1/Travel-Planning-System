import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import {
  Airline,
  CancellationTier,
  CancellationTierSchema,
  ExtraBaggagePolicy,
  ExtraBaggagePolicySchema,
  hasDistinctCancellationThresholds,
} from '../../airlines/schemas/airline.schema';
import {
  BookingStatus as FlightBookingStatus,
  wasConfirmed,
} from '../../common/booking-status';
import {
  CabinClass,
  CabinInventory,
} from '../../flights/schemas/cabin-inventory.schema';
import { Flight } from '../../flights/schemas/flight.schema';
import { User } from '../../users/schemas/user.schema';
import { Currency } from '../../reference-data/schemas/currency.schema';
import { Passenger, PassengerSchema, PassengerType } from './passenger.schema';

export { FlightBookingStatus };

@Schema({ _id: false })
class FlightBookingSegment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Flight.name,
    required: true,
  })
  flightId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: CabinInventory.name,
    required: true,
  })
  cabinInventoryId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Airline.name,
    required: true,
  })
  airlineId: Types.ObjectId;

  @Prop({ type: String, enum: CabinClass, required: true })
  cabinClass: CabinClass;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  cabinFareMinorUnits: number;

  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  freeBagCount: number;

  @Prop({ required: true, min: Number.MIN_VALUE, validate: Number.isFinite })
  maxBagWeightKg: number;

  @Prop({ type: ExtraBaggagePolicySchema })
  extraBaggagePolicy?: ExtraBaggagePolicy;

  @Prop({
    type: [CancellationTierSchema],
    required: true,
    default: [],
    castNonArrays: false,
    validate: {
      validator: hasDistinctCancellationThresholds,
      message: 'Cancellation tiers must have distinct departure thresholds.',
    },
  })
  cancellationTiers: CancellationTier[];
}

const FlightBookingSegmentSchema =
  SchemaFactory.createForClass(FlightBookingSegment);

@Schema({ timestamps: true })
export class FlightBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: FlightBookingStatus,
    required: true,
    default: FlightBookingStatus.PENDING_PAYMENT,
  })
  status: FlightBookingStatus;

  @Prop({ type: String, trim: true, uppercase: true, required: wasConfirmed })
  reference?: string;

  @Prop({ type: Date, required: true })
  holdExpiresAt: Date;

  @Prop({ type: Date, required: wasConfirmed })
  policyAcceptedAt?: Date;

  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    ref: Currency.name,
  })
  currency: string;

  @Prop({ required: true, min: 1, validate: Number.isSafeInteger })
  totalMinorUnits: number;

  @Prop({
    type: [FlightBookingSegmentSchema],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (segments: (FlightBookingSegment | null)[]) =>
        segments.length >= 1 && segments.length <= 2 && segments.every(Boolean),
      message:
        'A flight booking needs one outbound segment and at most one return segment.',
    },
  })
  segments: FlightBookingSegment[];

  @Prop({
    type: [PassengerSchema],
    required: true,
    castNonArrays: false,
    validate: {
      validator: (passengers: (Passenger | null)[]) =>
        passengers.length > 0 && passengers.every(Boolean),
      message: 'A flight booking needs at least one passenger.',
    },
  })
  passengers: Passenger[];
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

FlightBookingSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
FlightBookingSchema.index({ userId: 1, createdAt: -1 });
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });

FlightBookingSchema.pre('validate', function () {
  const { segments, passengers } = this;
  if (
    !segments?.length ||
    segments.some((segment) => !segment) ||
    !passengers?.length ||
    passengers.some((passenger) => !passenger)
  ) {
    return;
  }

  if (
    segments.length === 2 &&
    segments[0].flightId?.equals(segments[1].flightId)
  ) {
    this.invalidate('segments', 'Outbound and return flights must differ.');
  }

  if (
    passengers.some(
      (passenger) =>
        passenger.segments?.length !== segments.length ||
        passenger.segments.some((selection) => !selection),
    )
  ) {
    this.invalidate(
      'passengers',
      'Each passenger needs a selection for every flight segment.',
    );
    return;
  }

  let total = 0;
  for (const [index, segment] of segments.entries()) {
    const selections = passengers.map((passenger) => passenger.segments[index]);
    const adults = selections.filter(
      (selection) => selection.type === PassengerType.ADULT,
    ).length;
    const infants = selections.filter(
      (selection) => selection.type === PassengerType.INFANT,
    ).length;
    if (adults === 0 || infants > adults) {
      this.invalidate(
        'passengers',
        'Each segment needs an adult and can have at most one infant per adult.',
      );
    }

    for (const selection of selections) {
      const maxExtraBags =
        segment.extraBaggagePolicy?.maxExtraBagsPerPassenger ?? 0;
      if (
        selection.extraBagWeightsKg?.length > maxExtraBags ||
        selection.extraBagWeightsKg?.some(
          (weight) => weight > segment.maxBagWeightKg,
        )
      ) {
        this.invalidate(
          'passengers',
          'Extra baggage exceeds the booked cabin policy.',
        );
      }
      total += selection.fareMinorUnits + selection.baggageFeeMinorUnits;
    }
  }

  if (total !== this.totalMinorUnits) {
    this.invalidate(
      'totalMinorUnits',
      'The booking total must match its passenger fares and baggage fees.',
    );
  }
});
