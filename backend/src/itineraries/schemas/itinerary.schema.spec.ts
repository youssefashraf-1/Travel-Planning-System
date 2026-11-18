import { model, Types } from 'mongoose';
import { BudgetCategory } from './budget-entry.schema';
import { Itinerary, ItinerarySchema } from './itinerary.schema';

const ItineraryModel = model(Itinerary.name, ItinerarySchema);
const itinerary = {
  ownerId: new Types.ObjectId(),
  title: 'Visit Egypt',
  countryCodes: ['eg'],
  startDate: '2027-01-10',
};

describe('Itinerary days and costs', () => {
  it('accepts an ordered day with activities, budget entries, and intercity transport', async () => {
    const trip = new ItineraryModel({
      ...itinerary,
      days: [
        {
          cityId: 'cairo',
          activities: [
            {
              name: 'Museum',
              description: 'See the exhibits',
              cost: { amountMinorUnits: 0, currency: 'EGP' },
            },
          ],
          budgetEntries: [
            {
              category: BudgetCategory.FOOD,
              amountMinorUnits: 50000,
              currency: 'EGP',
            },
          ],
          transportCosts: [
            {
              mode: 'train',
              fromCityId: 'cairo',
              toCityId: 'alexandria',
              amountMinorUnits: 700,
              currency: 'EUR',
            },
          ],
        },
      ],
    });

    await expect(trip.validate()).resolves.toBeUndefined();
    trip.days[0].transportCosts[0].toCityId = 'cairo';
    await expect(trip.validate()).rejects.toMatchObject({
      errors: { 'days.0.transportCosts.0.toCityId': expect.any(Error) },
    });
  });

  it('enforces the 60-day limit', async () => {
    const trip = new ItineraryModel({
      ...itinerary,
      days: Array.from({ length: 60 }, () => ({ cityId: 'cairo' })),
    });

    await expect(trip.validate()).resolves.toBeUndefined();
    await expect(
      new ItineraryModel({
        ...itinerary,
        days: Array.from({ length: 61 }, () => ({ cityId: 'cairo' })),
      }).validate(),
    ).rejects.toMatchObject({ errors: { days: expect.any(Error) } });
  });
});
