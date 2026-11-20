import { readReferenceData, validateReferenceLinks } from './reference-data';

describe('Reference dataset', () => {
  it('has unique identifiers and links every location to its reference records', () => {
    const data = readReferenceData();

    expect(() => validateReferenceLinks(data)).not.toThrow();
    expect(data.airports.some((airport) => airport.iataCode === 'CAI')).toBe(
      true,
    );
  });

  it('rejects an airport whose city belongs to a different country', () => {
    const data = readReferenceData();
    const cairo = data.airports.find((airport) => airport.iataCode === 'CAI');
    if (!cairo)
      throw new Error('Expected Cairo airport in the official dataset.');
    cairo.countryCode = 'AE';

    expect(() => validateReferenceLinks(data)).toThrow(/CAI/);
  });
});
