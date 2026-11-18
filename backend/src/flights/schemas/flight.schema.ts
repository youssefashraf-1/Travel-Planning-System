import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Airline } from '../../airlines/schemas/airline.schema';
import { Airport } from '../../airports/schemas/airport.schema';

export enum FlightStatus {
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled',
  DEPARTED = 'departed',
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

@Schema({ timestamps: true })
export class Flight {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Airline.name,
    required: true,
  })
  airlineId: Types.ObjectId;

  @Prop({
    required: true,
    set: (value: string) => value?.replace(/\s+/g, '').toUpperCase(),
  })
  flightNumber: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Airport.name,
    required: true,
  })
  departureAirportId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Airport.name,
    required: true,
  })
  arrivalAirportId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  departureAt: Date;

  @Prop({ type: Date, required: true })
  arrivalAt: Date;

  @Prop({
    required: true,
    validate: {
      validator: isCalendarDate,
      message: 'Departure local date must be a real date in YYYY-MM-DD format.',
    },
  })
  departureLocalDate: string;

  @Prop({
    type: String,
    enum: FlightStatus,
    required: true,
    default: FlightStatus.SCHEDULED,
  })
  status: FlightStatus;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);

FlightSchema.pre('validate', function () {
  if (
    this.departureAirportId &&
    this.arrivalAirportId &&
    this.departureAirportId.equals(this.arrivalAirportId)
  ) {
    this.invalidate(
      'arrivalAirportId',
      'Arrival and departure airports must differ.',
    );
  }

  if (
    this.departureAt &&
    this.arrivalAt &&
    this.arrivalAt <= this.departureAt
  ) {
    this.invalidate('arrivalAt', 'Arrival must be after departure.');
  }
});
