import { csvCell } from './flight-booking-views.service';

describe('Passenger CSV safety', () => {
  it('escapes quotes, commas and embedded newlines as one field', () => {
    expect(csvCell('Ada "A", Name\nNext')).toBe('"Ada ""A"", Name\nNext"');
  });
  it.each(['=SUM(1,2)', '+1+1', '-1+1', '@SUM(1)', '  =1', '\tname', '\rname'])(
    'neutralizes formula-like input %j',
    (value) => {
      expect(csvCell(value).startsWith('"\'')).toBe(true);
    },
  );
});
