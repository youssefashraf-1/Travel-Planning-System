import type { CancellationTier } from '../airlines/schemas/airline.schema';
import { PassengerType } from './schemas/passenger.schema';

/** FLT-22: how long a pending booking holds its seats. */
export const HOLD_MINUTES = 10;

/** Most passengers one booking may contain. */
export const MAX_PASSENGERS = 9;

/** FLT-12: infants pay this share of the cabin fare and take no seat. */
export const INFANT_FARE_PERCENT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole years between a YYYY-MM-DD birth date and a YYYY-MM-DD date. */
export function ageOn(dateOfBirth: string, onDate: string): number {
  const years = Number(onDate.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  // Before this year's birthday? Born on 29 February: the birthday counts
  // from 1 March in non-leap years.
  return onDate.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** FLT-12: adult 12+, child 2–11, infant under 2, on the flight's date. */
export function passengerTypeOn(
  dateOfBirth: string,
  flightLocalDate: string,
): PassengerType {
  const age = ageOn(dateOfBirth, flightLocalDate);
  if (age >= 12) return PassengerType.ADULT;
  if (age >= 2) return PassengerType.CHILD;
  return PassengerType.INFANT;
}

/** FLT-12: adults and children pay the cabin fare, infants 10%. */
export function passengerFare(
  type: PassengerType,
  cabinFareMinorUnits: number,
): number {
  return type === PassengerType.INFANT
    ? Math.round((cabinFareMinorUnits * INFANT_FARE_PERCENT) / 100)
    : cabinFareMinorUnits;
}

/** Infants sit on an adult's lap; everyone else needs a seat. */
export function takesSeat(type: PassengerType): boolean {
  return type !== PassengerType.INFANT;
}

/**
 * FLT-09: the tier with the highest threshold not exceeding the whole days
 * left before departure decides the refund; no matching tier means 0%.
 */
export function refundPercentage(
  tiers: Pick<CancellationTier, 'daysBeforeDeparture' | 'refundPercentage'>[],
  departureAt: Date,
  now: Date,
): number {
  const daysLeft = Math.floor((departureAt.getTime() - now.getTime()) / DAY_MS);
  const tier = tiers
    .filter((candidate) => candidate.daysBeforeDeparture <= daysLeft)
    .sort((a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture)[0];
  return tier?.refundPercentage ?? 0;
}

/** Rounded down so a refund never exceeds the percentage. */
export function refundAmount(totalMinorUnits: number, percentage: number) {
  return Math.floor((totalMinorUnits * percentage) / 100);
}

/** Booking references avoid look-alike characters (0/O, 1/I). */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newBookingReference(random = Math.random): string {
  let reference = '';
  for (let index = 0; index < 6; index++) {
    reference +=
      REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  }
  return reference;
}
