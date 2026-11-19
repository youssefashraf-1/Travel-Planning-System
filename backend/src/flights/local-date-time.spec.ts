import { BadRequestException } from '@nestjs/common';
import { airportLocalDateTime, airportLocalToUtc } from './local-date-time';

describe('Airport local time conversion (FLT-03, GEN-06)', () => {
  it.each([
    ['2027-01-15T10:30', 'Africa/Cairo', '2027-01-15T08:30:00.000Z'],
    ['2027-07-15T10:30', 'Europe/London', '2027-07-15T09:30:00.000Z'],
    ['2027-01-15T10:30', 'Europe/London', '2027-01-15T10:30:00.000Z'],
    ['2027-01-15T00:15', 'Asia/Tokyo', '2027-01-14T15:15:00.000Z'],
    ['2027-01-15T23:30', 'America/New_York', '2027-01-16T04:30:00.000Z'],
    ['2027-01-15T10:30', 'Asia/Kathmandu', '2027-01-15T04:45:00.000Z'],
    ['2028-02-29T00:00', 'UTC', '2028-02-29T00:00:00.000Z'],
  ])('converts %s at %s to UTC and round-trips', (local, zone, utc) => {
    const result = airportLocalToUtc(local, zone);
    expect(result.toISOString()).toBe(utc);
    expect(airportLocalDateTime(result, zone)).toBe(local);
  });

  it.each([
    ['2027-03-14T02:30', 'America/New_York'], // spring gap
    ['2027-11-07T01:30', 'America/New_York'], // fall overlap
    ['2027-10-03T02:15', 'Australia/Lord_Howe'], // half-hour gap
    ['2027-04-04T01:45', 'Australia/Lord_Howe'], // half-hour overlap
    ['2027-02-29T10:30', 'UTC'],
    ['2027-01-15T24:00', 'UTC'],
    ['2027-01-15T10:30Z', 'UTC'],
    ['2027-01-15T10:30:00', 'UTC'],
    ['2027-01-15T10:30', 'Invalid/Zone'],
  ])(
    'rejects nonexistent, ambiguous or malformed local times: %s %s',
    (local, zone) => {
      expect(() => airportLocalToUtc(local, zone)).toThrow(BadRequestException);
    },
  );
});
