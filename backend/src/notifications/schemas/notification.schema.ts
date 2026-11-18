import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { Airline } from '../../airlines/schemas/airline.schema';
import { FlightBooking } from '../../flight-bookings/schemas/flight-booking.schema';
import { Flight } from '../../flights/schemas/flight.schema';
import { HotelBooking } from '../../hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../../hotels/schemas/hotel.schema';
import { Refund } from '../../payments/schemas/refund.schema';
import { User } from '../../users/schemas/user.schema';

export enum NotificationType {
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELLED = 'booking_cancelled',
  REFUND_UPDATED = 'refund_updated',
  FLIGHT_SCHEDULE_CHANGED = 'flight_schedule_changed',
  ACCOUNT_STATUS_CHANGED = 'account_status_changed',
  PROVIDER_STATUS_CHANGED = 'provider_status_changed',
}

const subjectModels: Record<NotificationType, readonly string[]> = {
  [NotificationType.BOOKING_CONFIRMED]: [FlightBooking.name, HotelBooking.name],
  [NotificationType.BOOKING_CANCELLED]: [FlightBooking.name, HotelBooking.name],
  [NotificationType.REFUND_UPDATED]: [Refund.name],
  [NotificationType.FLIGHT_SCHEDULE_CHANGED]: [Flight.name],
  [NotificationType.ACCOUNT_STATUS_CHANGED]: [User.name],
  [NotificationType.PROVIDER_STATUS_CHANGED]: [Airline.name, Hotel.name],
};

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  recipientId: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type: NotificationType;

  @Prop({
    required: true,
    validate: {
      validator: function (this: Notification, value: string) {
        return subjectModels[this.type]?.includes(value) ?? false;
      },
      message: 'The notification subject must match the event type.',
    },
  })
  subjectModel: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    refPath: 'subjectModel',
    required: true,
  })
  subjectId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  message: string;

  @Prop({ required: true, trim: true })
  eventKey: string;

  @Prop({ type: Date, default: null })
  readAt: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipientId: 1, createdAt: -1 });
NotificationSchema.index({ recipientId: 1, readAt: 1 });
NotificationSchema.index({ recipientId: 1, eventKey: 1 }, { unique: true });
