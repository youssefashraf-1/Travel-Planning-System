import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { BookingStatus } from '../common/booking-status';
import { newBookingReference } from '../flight-bookings/flight-booking-rules';
import { RoomsService } from '../hotels/rooms.service';
import { Hotel } from '../hotels/schemas/hotel.schema';
import {
  Notification,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { Payment, PaymentStatus } from '../payments/schemas/payment.schema';
import { HotelBooking } from './schemas/hotel-booking.schema';

/**
 * The parts of the GEN-11 lifecycle that need no traveler request: holds
 * expire after 10 minutes (HTL-18) and paid holds become Confirmed
 * (HTL-17). Finished stays become Completed in HotelStayStatusService.
 */
@Injectable()
export class HotelBookingLifecycleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(HotelBookingLifecycleService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
    private readonly rooms: RoomsService,
  ) {}

  /**
   * HTL-18: an unpaid hold whose 10 minutes passed becomes Expired. Rooms
   * are free again at once, because availability is worked out from the
   * reservations that still occupy them.
   */
  async expireDueHolds(
    now = new Date(),
    filter: QueryFilter<HotelBooking> = {},
  ): Promise<number> {
    const due = {
      ...filter,
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: { $lte: now },
    };
    const ids = (await this.bookings.find(due).select('_id').lean().exec()).map(
      (booking) => booking._id,
    );
    if (ids.length === 0) return 0;
    const result = await this.bookings
      .updateMany(
        { ...due, _id: { $in: ids } },
        { $set: { status: BookingStatus.EXPIRED } },
      )
      .exec();
    // PAY-01: the payment service must also cancel the Stripe intent and
    // refuse a late success for these reservations.
    await this.payments
      .updateMany(
        {
          bookingModel: 'HotelBooking' as const,
          bookingId: { $in: ids },
          status: PaymentStatus.PENDING,
        },
        { $set: { status: PaymentStatus.CANCELLED } },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * HTL-17: called by the payment service once Stripe confirms payment
   * (PAY-01). The hold must still be valid and the policies accepted
   * (PAY-02). Sets a unique reference and notifies the traveler. Pass the
   * payment's session to confirm in the same transaction.
   */
  async confirmPaidReservation(
    bookingId: Types.ObjectId | string,
    options: { session?: ClientSession; now?: Date } = {},
  ) {
    const now = options.now ?? new Date();
    const work = async (session: ClientSession) => {
      const booking = Types.ObjectId.isValid(bookingId)
        ? await this.bookings.findById(bookingId).session(session).exec()
        : null;
      if (!booking) throw new NotFoundException('Reservation not found.');
      if (booking.status !== BookingStatus.PENDING_PAYMENT)
        throw new ConflictException(
          'Only a reservation waiting for payment can be confirmed.',
        );
      if (booking.holdExpiresAt <= now)
        throw new ConflictException('The room hold has expired.');
      if (!booking.policyAcceptedAt)
        throw new ConflictException(
          'The reservation policies must be accepted before payment (PAY-02).',
        );
      // Serializes with room schedule changes (Phase 7 contract).
      await this.rooms.lockAvailability(
        booking.rooms.map((room) => room.roomId),
        session,
      );

      booking.status = BookingStatus.CONFIRMED;
      booking.reference = await this.uniqueReference(session);
      await booking.save({ session });

      const hotel = await this.hotels
        .findById(booking.hotelId)
        .select('name')
        .session(session)
        .lean()
        .exec();
      const roomLabels = booking.rooms.map((room) => room.label).join(', ');
      await this.notifications.create(
        [
          {
            recipientId: booking.userId,
            type: NotificationType.BOOKING_CONFIRMED,
            subjectModel: HotelBooking.name,
            subjectId: booking._id,
            title: 'Hotel reservation confirmed',
            message: `Your reservation ${booking.reference} at ${hotel?.name ?? 'the hotel'} is confirmed: room ${roomLabels}, ${booking.checkInDate} to ${booking.checkOutDate}.`,
            eventKey: `hotel-booking-confirmed:${booking._id.toString()}`,
          },
        ],
        { session },
      );
      return booking;
    };
    return options.session
      ? work(options.session)
      : this.connection.transaction(work);
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
      await this.expireDueHolds();
    } catch {
      this.logger.error('Unable to expire hotel reservation holds.');
    }
  }

  private async uniqueReference(session: ClientSession): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reference = newBookingReference();
      if (!(await this.bookings.exists({ reference }).session(session)))
        return reference;
    }
    throw new ConflictException('Could not create a booking reference.');
  }
}
