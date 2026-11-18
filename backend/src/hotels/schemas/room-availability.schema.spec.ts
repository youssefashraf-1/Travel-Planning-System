import { model, Types } from 'mongoose';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from './room-availability.schema';

const Availability = model(RoomAvailability.name, RoomAvailabilitySchema);

describe('Room availability', () => {
  it('allows adjacent booking windows and blocks within those windows', async () => {
    const availability = new Availability({
      roomId: new Types.ObjectId(),
      bookableRanges: [
        { fromDate: '2027-02-15', untilDate: '2027-02-20' },
        { fromDate: '2027-02-10', untilDate: '2027-02-15' },
      ],
      blockedRanges: [{ fromDate: '2027-02-12', untilDate: '2027-02-13' }],
    });

    await expect(availability.validate()).resolves.toBeUndefined();
    expect(availability.bookableRanges[0].fromDate).toBe('2027-02-15');
  });

  it('rejects overlapping windows even when provided out of order', async () => {
    const availability = new Availability({
      roomId: new Types.ObjectId(),
      bookableRanges: [
        { fromDate: '2027-02-14', untilDate: '2027-02-20' },
        { fromDate: '2027-02-10', untilDate: '2027-02-15' },
      ],
    });

    await expect(availability.validate()).rejects.toMatchObject({
      errors: { bookableRanges: expect.any(Error) },
    });
  });
});
