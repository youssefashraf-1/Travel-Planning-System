import { model, Types } from 'mongoose';
import { BookingStatus } from '../../common/booking-status';
import { HotelBooking, HotelBookingSchema } from './hotel-booking.schema';

const Booking = model(HotelBooking.name, HotelBookingSchema);

function reservation() {
  return {
    hotelId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    checkInDate: '2027-03-13',
    checkOutDate: '2027-03-15',
    timeZone: 'America/New_York',
    holdExpiresAt: new Date('2027-01-01T00:10:00Z'),
    currency: 'EGP',
    totalMinorUnits: 46000,
    policy: { checkInTime: '15:00', checkOutTime: '11:00' },
    rooms: [
      {
        roomId: new Types.ObjectId(),
        label: '101',
        maxOccupancy: 2,
        nightlyPriceMinorUnits: 10000,
        adults: 1,
      },
      {
        roomId: new Types.ObjectId(),
        label: '102',
        maxOccupancy: 2,
        nightlyPriceMinorUnits: 13000,
        adults: 0,
        childAges: [10, 15],
      },
    ],
  };
}

describe('Hotel reservation', () => {
  it('prices both nights for all rooms when daylight saving shortens the elapsed time', async () => {
    const booking = new Booking(reservation());

    await expect(booking.validate()).resolves.toBeUndefined();
    booking.totalMinorUnits = 23000;
    await expect(booking.validate()).rejects.toMatchObject({
      errors: { totalMinorUnits: expect.any(Error) },
    });
  });

  it.each([
    [
      'the same room twice',
      (booking: HotelBooking) => {
        booking.rooms[1].roomId = booking.rooms[0].roomId;
      },
    ],
    [
      'a room over capacity',
      (booking: HotelBooking) => {
        booking.rooms[1].adults = 1;
      },
    ],
    [
      'a reservation with no adults',
      (booking: HotelBooking) => {
        booking.rooms[0].adults = 0;
        booking.rooms[0].childAges = [16];
      },
    ],
  ])('rejects %s', async (_description, update) => {
    const booking = new Booking(reservation());
    update(booking);

    await expect(booking.validate()).rejects.toMatchObject({
      errors: { rooms: expect.any(Error) },
    });
  });

  it('requires a reference and accepted policy before storing a confirmed reservation', async () => {
    const booking = new Booking({
      ...reservation(),
      status: BookingStatus.CONFIRMED,
    });

    await expect(booking.validate()).rejects.toMatchObject({
      errors: {
        reference: expect.any(Error),
        policyAcceptedAt: expect.any(Error),
      },
    });
  });
});
