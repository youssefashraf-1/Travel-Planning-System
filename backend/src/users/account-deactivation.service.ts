import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { SessionsService } from '../auth/sessions.service';
import { BookingStatus } from '../common/booking-status';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { User, UserStatus } from './schemas/user.schema';

export const UPCOMING_BOOKINGS_MESSAGE =
  'You have upcoming confirmed bookings. Cancel them or wait until they ' +
  'are completed before deactivating your account.';

/**
 * ACC-12: a registered user deactivates their own account. A deactivated
 * user cannot log in. Their posts, public itineraries, comments and reviews
 * are hidden or anonymised by those features using the account status.
 */
@Injectable()
export class AccountDeactivationService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(FlightBooking.name)
    private readonly flightBookingModel: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookingModel: Model<HotelBooking>,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessionsService: SessionsService,
  ) {}

  async deactivateOwnAccount(
    userId: Types.ObjectId,
    dto: DeactivateAccountDto,
    now = new Date(),
  ): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .exec();
    if (!user) {
      throw new NotFoundException('Account not found.');
    }
    const passwordMatches = await this.passwordHasher.verify(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new BadRequestException('The current password is incorrect.');
    }

    if (await this.hasUpcomingConfirmedBookings(userId, now)) {
      throw new ConflictException(UPCOMING_BOOKINGS_MESSAGE);
    }

    await this.userModel
      .updateOne(
        { _id: userId, status: UserStatus.ACTIVE },
        { $set: { status: UserStatus.DEACTIVATED } },
      )
      .exec();
    await this.sessionsService.revokeAllForUser(userId, now);
  }

  /**
   * A confirmed flight booking is upcoming while any of its flights has not
   * departed. A confirmed hotel booking is upcoming until its check-out date.
   */
  async hasUpcomingConfirmedBookings(
    userId: Types.ObjectId,
    now: Date,
  ): Promise<boolean> {
    const today = now.toISOString().slice(0, 10);
    const upcomingStay = await this.hotelBookingModel.exists({
      userId,
      status: BookingStatus.CONFIRMED,
      checkOutDate: { $gt: today },
    });
    if (upcomingStay) {
      return true;
    }

    const confirmedFlights = await this.flightBookingModel
      .find({ userId, status: BookingStatus.CONFIRMED })
      .select('segments.flightId')
      .lean()
      .exec();
    const flightIds = confirmedFlights.flatMap((booking) =>
      booking.segments.map((segment) => segment.flightId),
    );
    if (flightIds.length === 0) {
      return false;
    }
    const upcomingFlight = await this.flightModel.exists({
      _id: { $in: flightIds },
      departureAt: { $gt: now },
    });
    return upcomingFlight !== null;
  }
}
