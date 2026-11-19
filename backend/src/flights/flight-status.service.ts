import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Flight, FlightStatus } from './schemas/flight.schema';

/** Effective status is exact even between persistence sweeps (FLT-30). */
export function effectiveFlightStatus(
  flight: Pick<Flight, 'status' | 'departureAt'>,
  now = new Date(),
): FlightStatus {
  return flight.status === FlightStatus.SCHEDULED && flight.departureAt <= now
    ? FlightStatus.DEPARTED
    : flight.status;
}

@Injectable()
export class FlightStatusService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FlightStatusService.name);
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
  ) {}

  async markDeparted(now = new Date()): Promise<void> {
    await this.flights
      .updateMany(
        { status: FlightStatus.SCHEDULED, departureAt: { $lte: now } },
        { $set: { status: FlightStatus.DEPARTED } },
      )
      .exec();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.markDeparted();
    this.timer = setInterval(() => {
      void this.markDeparted().catch(() =>
        this.logger.error('Unable to update departed flight statuses.'),
      );
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
