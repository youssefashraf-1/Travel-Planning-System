import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

function isIanaTimeZone(value: string): boolean {
  // Intl also accepts fixed offsets, which do not describe daylight saving rules.
  if (/^[+-]/.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

@Schema()
export class Airport {
  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z]{3}$/,
    unique: true,
  })
  iataCode: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  cityId: string;

  @Prop({ required: true, trim: true, uppercase: true, match: /^[A-Z]{2}$/ })
  countryCode: string;

  @Prop({
    required: true,
    trim: true,
    validate: {
      validator: isIanaTimeZone,
      message: 'Airport time zone must be a valid IANA time zone.',
    },
  })
  timeZone: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);
