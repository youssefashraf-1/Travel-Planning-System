import {
  addDays,
  coversStay,
  datesBetween,
  hasOverlaps,
  hotelNow,
  nightsBetween,
  overlaps,
} from './hotel-dates';
import { roomIsFree } from './rooms.service';

const range = (fromDate: string, untilDate: string) => ({
  fromDate,
  untilDate,
});

describe('hotel dates', () => {
  it('counts nights and steps through dates, across month and leap day', () => {
    expect(nightsBetween('2028-02-27', '2028-03-01')).toBe(3);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(datesBetween('2027-12-30', '2028-01-02')).toEqual([
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
    ]);
  });

  it('treats ranges as first night included, last date excluded', () => {
    expect(
      overlaps(
        range('2027-02-01', '2027-02-05'),
        range('2027-02-05', '2027-02-07'),
      ),
    ).toBe(false);
    expect(
      overlaps(
        range('2027-02-01', '2027-02-05'),
        range('2027-02-04', '2027-02-07'),
      ),
    ).toBe(true);
    expect(
      hasOverlaps([
        range('2027-02-05', '2027-02-09'),
        range('2027-02-01', '2027-02-05'),
      ]),
    ).toBe(false);
    expect(
      hasOverlaps([
        range('2027-02-04', '2027-02-09'),
        range('2027-02-01', '2027-02-05'),
      ]),
    ).toBe(true);
  });

  it('accepts a stay covered by touching ranges and rejects gaps', () => {
    const ranges = [
      range('2027-02-10', '2027-02-20'),
      range('2027-02-01', '2027-02-10'),
    ];
    expect(coversStay(ranges, range('2027-02-05', '2027-02-15'))).toBe(true);
    expect(coversStay(ranges, range('2027-02-15', '2027-02-21'))).toBe(false);
    expect(
      coversStay(
        [range('2027-02-01', '2027-02-05'), range('2027-02-06', '2027-02-10')],
        range('2027-02-03', '2027-02-08'),
      ),
    ).toBe(false);
    expect(coversStay([], range('2027-02-01', '2027-02-02'))).toBe(false);
  });

  it('gives the date and time in the hotel time zone', () => {
    const instant = new Date('2027-01-31T23:30:00Z');
    expect(hotelNow('Africa/Cairo', instant)).toEqual({
      date: '2027-02-01',
      dateTime: '2027-02-01T01:30',
    });
    expect(hotelNow('America/New_York', instant).date).toBe('2027-01-31');
  });

  describe('roomIsFree', () => {
    const availability = {
      bookableRanges: [range('2027-02-01', '2027-03-01')],
      blockedRanges: [range('2027-02-10', '2027-02-12')],
    };
    it.each([
      [
        'a stay inside bookable dates',
        range('2027-02-02', '2027-02-05'),
        true,
        false,
        true,
      ],
      [
        'a stay touching a block',
        range('2027-02-08', '2027-02-11'),
        true,
        false,
        false,
      ],
      [
        'a stay ending as the block starts',
        range('2027-02-08', '2027-02-10'),
        true,
        false,
        true,
      ],
      [
        'a stay outside bookable dates',
        range('2027-02-27', '2027-03-02'),
        true,
        false,
        false,
      ],
      [
        'an inactive room',
        range('2027-02-02', '2027-02-05'),
        false,
        false,
        false,
      ],
      [
        'a room with a reservation',
        range('2027-02-02', '2027-02-05'),
        true,
        true,
        false,
      ],
    ])('%s', (_case, stay, isActive, reserved, expected) => {
      expect(roomIsFree({ isActive }, availability, stay, reserved)).toBe(
        expected,
      );
    });
  });
});
