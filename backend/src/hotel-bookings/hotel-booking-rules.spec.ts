import { roomsCanHost } from '../hotels/hotel-search.service';
import { hotelRefundPercentage } from './hotel-bookings.service';

describe('hotel booking rules', () => {
  it('fits the guests into the largest free rooms (HTL-11)', () => {
    expect(roomsCanHost([2, 4, 2], 1, 4)).toBe(true);
    expect(roomsCanHost([2, 4, 2], 1, 5)).toBe(false);
    expect(roomsCanHost([2, 4, 2], 2, 6)).toBe(true);
    expect(roomsCanHost([2, 4, 2], 2, 7)).toBe(false);
    expect(roomsCanHost([2, 4], 3, 2)).toBe(false);
  });

  it('uses the highest tier not above the days left (HTL-10, HTL-21)', () => {
    const tiers = [
      { daysBeforeCheckIn: 2, refundPercentage: 50 },
      { daysBeforeCheckIn: 14, refundPercentage: 100 },
    ];
    expect(hotelRefundPercentage(tiers, 30)).toBe(100);
    expect(hotelRefundPercentage(tiers, 14)).toBe(100);
    expect(hotelRefundPercentage(tiers, 13)).toBe(50);
    expect(hotelRefundPercentage(tiers, 2)).toBe(50);
    expect(hotelRefundPercentage(tiers, 1)).toBe(0);
    expect(hotelRefundPercentage([], 100)).toBe(0);
  });
});
