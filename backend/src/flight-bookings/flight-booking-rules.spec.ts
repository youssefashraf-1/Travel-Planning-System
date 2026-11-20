import { PassengerType } from './schemas/passenger.schema';
import {
  ageOn,
  newBookingReference,
  passengerFare,
  passengerTypeOn,
  refundAmount,
  refundPercentage,
} from './flight-booking-rules';
import { maskDocumentNumber } from './flight-bookings.service';

describe('flight booking rules', () => {
  it('counts whole years, with birthdays on the exact day', () => {
    expect(ageOn('2014-06-15', '2026-06-14')).toBe(11);
    expect(ageOn('2014-06-15', '2026-06-15')).toBe(12);
    // A 29 February birthday counts from 1 March in non-leap years.
    expect(ageOn('2012-02-29', '2026-02-28')).toBe(13);
    expect(ageOn('2012-02-29', '2026-03-01')).toBe(14);
  });

  it.each([
    ['2014-06-15', '2026-06-15', PassengerType.ADULT],
    ['2014-06-15', '2026-06-14', PassengerType.CHILD],
    ['2024-06-15', '2026-06-15', PassengerType.CHILD],
    ['2024-06-15', '2026-06-14', PassengerType.INFANT],
    ['2026-06-01', '2026-06-14', PassengerType.INFANT],
  ])('born %s, on %s, is %s', (dob, date, type) => {
    expect(passengerTypeOn(dob, date)).toBe(type);
  });

  it('charges infants 10% of the fare and everyone else the full fare', () => {
    expect(passengerFare(PassengerType.ADULT, 450_000)).toBe(450_000);
    expect(passengerFare(PassengerType.CHILD, 450_000)).toBe(450_000);
    expect(passengerFare(PassengerType.INFANT, 450_000)).toBe(45_000);
    expect(passengerFare(PassengerType.INFANT, 455)).toBe(46);
  });

  describe('refunds (FLT-09)', () => {
    const departure = new Date('2027-03-20T10:00:00Z');
    const tiers = [
      { daysBeforeDeparture: 30, refundPercentage: 100 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
      { daysBeforeDeparture: 1, refundPercentage: 10 },
    ];
    const daysBefore = (days: number, extraHours = 0) =>
      new Date(departure.getTime() - (days * 24 + extraHours) * 3_600_000);

    it('uses the highest threshold not above the whole days left', () => {
      expect(refundPercentage(tiers, departure, daysBefore(45))).toBe(100);
      expect(refundPercentage(tiers, departure, daysBefore(30))).toBe(100);
      expect(refundPercentage(tiers, departure, daysBefore(29, 23))).toBe(50);
      expect(refundPercentage(tiers, departure, daysBefore(7))).toBe(50);
      expect(refundPercentage(tiers, departure, daysBefore(1, 5))).toBe(10);
    });

    it('gives 0% when no tier applies or there are no tiers', () => {
      expect(refundPercentage(tiers, departure, daysBefore(0, 20))).toBe(0);
      expect(refundPercentage([], departure, daysBefore(60))).toBe(0);
    });

    it('rounds the amount down', () => {
      expect(refundAmount(1_001, 50)).toBe(500);
      expect(refundAmount(950_000, 75)).toBe(712_500);
    });
  });

  it('makes six-character references without look-alike characters', () => {
    const reference = newBookingReference();
    expect(reference).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(newBookingReference(() => 0)).toBe('AAAAAA');
    expect(newBookingReference(() => 0.9999)).toBe('999999');
  });

  it('shows only the last four characters of a document number', () => {
    expect(maskDocumentNumber('A12345678')).toBe('•••••5678');
    expect(maskDocumentNumber('ABC')).toBe('•••');
  });
});
