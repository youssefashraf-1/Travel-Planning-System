import { model, Types } from 'mongoose';
import {
  CabinClass,
  CabinInventory,
  CabinInventorySchema,
} from './cabin-inventory.schema';

const CabinInventoryModel = model(CabinInventory.name, CabinInventorySchema);

describe('Cabin capacity', () => {
  it('rejects a capacity below held and booked seats and allows a full cabin', async () => {
    const cabin = new CabinInventoryModel({
      flightId: new Types.ObjectId(),
      cabinClass: CabinClass.ECONOMY,
      totalSeats: 10,
      heldSeats: 3,
      bookedSeats: 8,
      priceMinorUnits: 12000,
      freeBagCount: 0,
      maxBagWeightKg: 23,
    });

    await expect(cabin.validate()).rejects.toMatchObject({
      errors: { totalSeats: expect.any(Error) },
    });

    cabin.totalSeats = 11;
    await expect(cabin.validate()).resolves.toBeUndefined();
  });
});
