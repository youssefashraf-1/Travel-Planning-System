import { model } from 'mongoose';
import { Airline, AirlineSchema } from './airline.schema';

const AirlineModel = model(Airline.name, AirlineSchema);
const profile = { name: 'Example Air', code: 'EA' };

describe('Airline policies', () => {
  it('allows a new profile before policies have been configured', async () => {
    const airline = new AirlineModel(profile);

    await expect(airline.validate()).resolves.toBeUndefined();
    expect(airline.isActive).toBe(true);
  });

  it('rejects two cancellation tiers with the same departure threshold', async () => {
    const airline = new AirlineModel({
      ...profile,
      cancellationTiers: [
        { daysBeforeDeparture: 7, refundPercentage: 50 },
        { daysBeforeDeparture: 7, refundPercentage: 80 },
      ],
    });

    await expect(airline.validate()).rejects.toMatchObject({
      errors: { cancellationTiers: expect.any(Error) },
    });

    airline.cancellationTiers[1].daysBeforeDeparture = 14;
    await expect(airline.validate()).resolves.toBeUndefined();
  });

  it('rejects an extra bag price of zero and accepts a bag limit of zero', async () => {
    const airline = new AirlineModel({
      ...profile,
      extraBaggagePolicy: {
        pricePerBagMinorUnits: 0,
        maxExtraBagsPerPassenger: 0,
      },
    });

    await expect(airline.validate()).rejects.toMatchObject({
      errors: { 'extraBaggagePolicy.pricePerBagMinorUnits': expect.any(Error) },
    });

    airline.extraBaggagePolicy!.pricePerBagMinorUnits = 2500;
    await expect(airline.validate()).resolves.toBeUndefined();
  });
});
