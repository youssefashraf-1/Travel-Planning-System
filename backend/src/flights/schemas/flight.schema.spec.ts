import { model, Types } from 'mongoose';
import { Flight, FlightSchema, FlightStatus } from './flight.schema';

const FlightModel = model(Flight.name, FlightSchema);

const flightData = {
  airlineId: new Types.ObjectId(),
  flightNumber: ' jl 62 ',
  departureAirportId: new Types.ObjectId(),
  arrivalAirportId: new Types.ObjectId(),
  departureAt: new Date('2027-01-10T18:00:00+09:00'),
  arrivalAt: new Date('2027-01-10T11:00:00-08:00'),
  departureLocalDate: '2027-01-10',
};

describe('Flight schedule', () => {
  it('allows a flight whose arrival clock time is earlier across time zones', async () => {
    const flight = new FlightModel(flightData);

    await expect(flight.validate()).resolves.toBeUndefined();
    expect(flight.status).toBe(FlightStatus.SCHEDULED);
    expect(flight.flightNumber).toBe('JL62');
  });

  it('rejects matching airport IDs', async () => {
    const flight = new FlightModel({
      ...flightData,
      arrivalAirportId: new Types.ObjectId(
        flightData.departureAirportId.toHexString(),
      ),
    });

    await expect(flight.validate()).rejects.toMatchObject({
      errors: { arrivalAirportId: expect.any(Error) },
    });
  });

  it.each(['2027-01-10T09:00:00Z', '2027-01-10T08:59:00Z'])(
    'rejects arrival at %s because it is not after departure',
    async (arrivalAt) => {
      const flight = new FlightModel({ ...flightData, arrivalAt });

      await expect(flight.validate()).rejects.toMatchObject({
        errors: { arrivalAt: expect.any(Error) },
      });
    },
  );

  it('rejects a day that looks valid but does not exist', async () => {
    const flight = new FlightModel({
      ...flightData,
      departureLocalDate: '2027-02-29',
    });

    await expect(flight.validate()).rejects.toMatchObject({
      errors: { departureLocalDate: expect.any(Error) },
    });
  });
});
