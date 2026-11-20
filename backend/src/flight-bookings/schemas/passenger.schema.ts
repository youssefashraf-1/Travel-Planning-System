import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { isCalendarDate } from '../../common/validation/calendar-date';

export enum PassengerType {
  ADULT = 'adult',
  CHILD = 'child',
  INFANT = 'infant',
}

@Schema({ _id: false })
class PassengerSegment {
  @Prop({ type: String, enum: PassengerType, required: true })
  type: PassengerType;

  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  fareMinorUnits: number;

  @Prop({
    type: [
      {
        type: Number,
        required: true,
        min: Number.MIN_VALUE,
        validate: Number.isFinite,
      },
    ],
    default: [],
    required: true,
    castNonArrays: false,
  })
  extraBagWeightsKg: number[];

  @Prop({ required: true, default: 0, min: 0, validate: Number.isSafeInteger })
  baggageFeeMinorUnits: number;

  /** FLT-28 (optional): the chosen seat, for example 21C. */
  @Prop({ type: String, uppercase: true })
  seat?: string;
}

const PassengerSegmentSchema = SchemaFactory.createForClass(PassengerSegment);

@Schema()
export class Passenger {
  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({
    required: true,
    validate: {
      validator: isCalendarDate,
      message: 'Passenger birth date must be a real date in YYYY-MM-DD format.',
    },
  })
  dateOfBirth: string;

  @Prop({ required: true, trim: true, select: false })
  passportOrIdNumber: string;

  @Prop({
    type: [PassengerSegmentSchema],
    required: true,
    castNonArrays: false,
  })
  segments: PassengerSegment[];
}

export const PassengerSchema = SchemaFactory.createForClass(Passenger);
