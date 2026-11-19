import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { BookingStatus } from '../common/booking-status';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { hotelNow } from './hotel-dates';

/**
 * HTL-23, GEN-11: a Confirmed reservation becomes Completed once its
 * check-out date and time have passed in the hotel's time zone. Runs at
 * startup and every 30 seconds, and on demand before reviews.
 */
@Injectable()
export class HotelStayStatusService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(HotelStayStatusService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
  ) {}

  async completeFinishedStays(
    now = new Date(),
    filter: QueryFilter<HotelBooking> = {},
  ): Promise<number> {
    const base = { ...filter, status: BookingStatus.CONFIRMED };
    const timeZones = (await this.bookings
      .distinct('timeZone', base)
      .exec()) as string[];
    let completed = 0;
    for (const timeZone of timeZones) {
      // Both sides are "YYYY-MM-DDTHH:mm" in hotel time, so text order is time order.
      const result = await this.bookings
        .updateMany(
          {
            ...base,
            timeZone,
            $expr: {
              $lte: [
                {
                  $concat: ['$checkOutDate', 'T', '$policy.checkOutTime'],
                },
                hotelNow(timeZone, now).dateTime,
              ],
            },
          },
          { $set: { status: BookingStatus.COMPLETED } },
        )
        .exec();
      completed += result.modifiedCount;
    }
    return completed;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      await this.completeFinishedStays();
    } catch {
      this.logger.error('Unable to mark finished hotel stays as completed.');
    }
  }
}
