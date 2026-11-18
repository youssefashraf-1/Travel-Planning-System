import { model, Types } from 'mongoose';
import {
  Notification,
  NotificationSchema,
  NotificationType,
} from './notification.schema';

const NotificationModel = model(Notification.name, NotificationSchema);

describe('Notification', () => {
  it('starts unread and requires the subject to match the event', async () => {
    const notification = new NotificationModel({
      recipientId: new Types.ObjectId(),
      type: NotificationType.BOOKING_CONFIRMED,
      subjectModel: 'HotelBooking',
      subjectId: new Types.ObjectId(),
      title: 'Booking confirmed',
      message: 'Your reservation is confirmed.',
      eventKey: 'booking-confirmed:example',
    });

    expect(notification.readAt).toBeNull();
    await expect(notification.validate()).resolves.toBeUndefined();

    notification.subjectModel = 'Refund';
    await expect(notification.validate()).rejects.toMatchObject({
      errors: { subjectModel: expect.any(Error) },
    });
  });
});
