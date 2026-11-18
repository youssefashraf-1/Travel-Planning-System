import { model } from 'mongoose';
import { Airport, AirportSchema } from './airport.schema';

const AirportModel = model(Airport.name, AirportSchema);
const cairo = {
  iataCode: ' cai ',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryCode: 'eg',
  timeZone: 'Africa/Cairo',
};

describe('Airport reference data', () => {
  it('accepts a named time zone and normalizes airport and country codes', async () => {
    const airport = new AirportModel(cairo);

    await expect(airport.validate()).resolves.toBeUndefined();
    expect(airport.iataCode).toBe('CAI');
    expect(airport.countryCode).toBe('EG');
  });

  it.each(['Africa/Atlantis', '+02:00'])(
    'rejects time zone %s',
    async (timeZone) => {
      const airport = new AirportModel({ ...cairo, timeZone });

      await expect(airport.validate()).rejects.toMatchObject({
        errors: { timeZone: expect.any(Error) },
      });
    },
  );

  it('rejects a code that is not a three-letter IATA code', async () => {
    const airport = new AirportModel({ ...cairo, iataCode: 'HECA' });

    await expect(airport.validate()).rejects.toMatchObject({
      errors: { iataCode: expect.any(Error) },
    });
  });
});
