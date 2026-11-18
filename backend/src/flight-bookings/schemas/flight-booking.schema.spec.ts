import { model, Types } from 'mongoose';
import { CabinClass } from '../../flights/schemas/cabin-inventory.schema';
import {
  FlightBooking,
  FlightBookingSchema,
  FlightBookingStatus,
} from './flight-booking.schema';
import { PassengerType } from './passenger.schema';

const FlightBookingModel = model(FlightBooking.name, FlightBookingSchema);
const airlineId = new Types.ObjectId();

function newSegment() {
  return {
    airlineId,
    flightId: new Types.ObjectId(),
    cabinInventoryId: new Types.ObjectId(),
    cabinClass: CabinClass.ECONOMY,
    cabinFareMinorUnits: 10000,
    freeBagCount: 1,
    maxBagWeightKg: 23,
    extraBaggagePolicy: {
      pricePerBagMinorUnits: 1500,
      maxExtraBagsPerPassenger: 1,
    },
  };
}

function roundTrip() {
  const adultFare = { type: PassengerType.ADULT, fareMinorUnits: 10000 };
  return {
    userId: new Types.ObjectId(),
    holdExpiresAt: new Date('2027-01-10T09:10:00Z'),
    currency: 'EGP',
    totalMinorUnits: 21500,
    segments: [newSegment(), newSegment()],
    passengers: [
      {
        fullName: 'Example Traveler',
        dateOfBirth: '1990-01-01',
        passportOrIdNumber: 'TEST-ID',
        segments: [
          adultFare,
          { ...adultFare, extraBagWeightsKg: [15], baggageFeeMinorUnits: 1500 },
        ],
      },
    ],
  };
}

describe('Flight booking and passengers', () => {
  it('accepts a round-trip hold without a reference and with bags on just one leg', async () => {
    const booking = new FlightBookingModel(roundTrip());

    await expect(booking.validate()).resolves.toBeUndefined();
    expect(booking.status).toBe(FlightBookingStatus.PENDING_PAYMENT);
    expect(booking.reference).toBeUndefined();
  });

  it('requires a reference and policy acceptance once confirmed', async () => {
    const booking = new FlightBookingModel({
      ...roundTrip(),
      status: FlightBookingStatus.CONFIRMED,
    });

    await expect(booking.validate()).rejects.toMatchObject({
      errors: {
        reference: expect.any(Error),
        policyAcceptedAt: expect.any(Error),
      },
    });

    booking.reference = 'fb-12345';
    booking.policyAcceptedAt = new Date('2027-01-10T09:00:00Z');
    await expect(booking.validate()).resolves.toBeUndefined();
  });

  it('requires passenger details for both legs of a round trip', async () => {
    const booking = new FlightBookingModel(roundTrip());
    booking.passengers[0].segments.pop();

    await expect(booking.validate()).rejects.toMatchObject({
      errors: { passengers: expect.any(Error) },
    });
  });

  it('rejects a leg without an adult even when another leg has one', async () => {
    const booking = new FlightBookingModel(roundTrip());
    booking.passengers[0].segments[1].type = PassengerType.CHILD;

    await expect(booking.validate()).rejects.toMatchObject({
      errors: { passengers: expect.any(Error) },
    });
  });

  it('rejects overweight baggage using the booked policy', async () => {
    const booking = new FlightBookingModel(roundTrip());
    booking.passengers[0].segments[1].extraBagWeightsKg = [24];

    await expect(booking.validate()).rejects.toMatchObject({
      errors: { passengers: expect.any(Error) },
    });
  });

  it('rejects a total that omits a leg or a baggage charge', async () => {
    const booking = new FlightBookingModel(roundTrip());
    booking.totalMinorUnits = 20000;

    await expect(booking.validate()).rejects.toMatchObject({
      errors: { totalMinorUnits: expect.any(Error) },
    });
  });
});
