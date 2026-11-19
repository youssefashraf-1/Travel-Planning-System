import { Model } from 'mongoose';
import {
  effectiveFlightStatus,
  FlightStatusService,
} from './flight-status.service';
import { Flight, FlightStatus } from './schemas/flight.schema';

describe('Flight departure status (FLT-30)', () => {
  const now = new Date('2027-01-01T12:00:00Z');
  it('treats a flight as departed exactly at departure, preserves cancelled and future states', () => {
    expect(
      effectiveFlightStatus(
        { status: FlightStatus.SCHEDULED, departureAt: now },
        now,
      ),
    ).toBe(FlightStatus.DEPARTED);
    expect(
      effectiveFlightStatus(
        { status: FlightStatus.CANCELLED, departureAt: now },
        now,
      ),
    ).toBe(FlightStatus.CANCELLED);
    expect(
      effectiveFlightStatus(
        {
          status: FlightStatus.SCHEDULED,
          departureAt: new Date(now.getTime() + 1),
        },
        now,
      ),
    ).toBe(FlightStatus.SCHEDULED);
  });
  it('persists only scheduled departures using an atomic conditional update', async () => {
    let received: unknown[] = [];
    const service = new FlightStatusService({
      updateMany: (...args: unknown[]) => {
        received = args;
        return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
      },
    } as unknown as Model<Flight>);
    await service.markDeparted(now);
    expect(received).toEqual([
      { status: 'scheduled', departureAt: { $lte: now } },
      { $set: { status: 'departed' } },
    ]);
  });
});
