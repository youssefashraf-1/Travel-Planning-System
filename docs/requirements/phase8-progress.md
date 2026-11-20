# Phase 8 progress: hotel search and booking

Source: official workbook HTL-11, HTL-12, HTL-16, HTL-17, HTL-18, HTL-20, HTL-21 and GEN-11, checked 2026-11-19. Amounts are EGP minor units (piastres).

## Endpoints

| Endpoint                                                  | Req            | Who                                              |
| --------------------------------------------------------- | -------------- | ------------------------------------------------ |
| `GET /api/hotels/search`                                  | HTL-11, HTL-12 | Public                                           |
| `POST /api/hotel-bookings`                                | HTL-16, HTL-18 | Travelers: reserve rooms, held for 10 minutes    |
| `GET /api/hotel-bookings?group=upcoming\|past\|cancelled` | HTL-20         | The traveler's own reservations                  |
| `GET /api/hotel-bookings/:id`                             | HTL-20, HTL-21 | Owner only, with a refund preview when confirmed |
| `POST /api/hotel-bookings/:id/cancel`                     | HTL-21         | Owner only; needs `{ "confirm": true }`          |

## Rules

- **Search** needs `cityId` or `countryCode`, the dates and `guests`. `rooms` defaults to 1.
  - **Dates:** check-out must be after check-in. A check-in already past everywhere returns 400; otherwise hotels whose own calendar has passed the check-in date are left out.
  - **Which hotels:** active hotels with policies, having at least `rooms` free rooms whose largest occupancies add up to the guests.
  - **Price** is the cheapest free room's nightly price; min/max filters are inclusive, and min > max is 400.
  - **Rating:** `minRating` leaves out unrated hotels.
  - **Sorting:** price ascending by default, or rating descending with unrated hotels last. Ties go by id. 10 per page.
- **Booking** takes one hotel, shared dates, and per room `adults` and `childAges` (0–17).
  - It needs at least one adult in total, no empty or overfull room, and each room only once.
  - Inside one transaction, all rooms are locked (the Phase 7 contract) and re-checked with `roomIsFree`. If any room is not free for the whole stay, nothing is held and the error names the rooms.
  - The reservation copies the hotel's time zone and policy, and each room's label, occupancy and nightly price. Total = nights × the sum of those prices.
  - The end-to-end test sends 8 simultaneous requests for one room: exactly 1 succeeds.
- **Lifecycle (GEN-11):**
  - Holds expire every 30 seconds, and also before availability checks and the traveler's views. The rooms are free again at once.
  - Completed stays come from the Phase 7 `HotelStayStatusService`.
  - My reservations: upcoming = held or confirmed, past = completed, cancelled = cancelled or expired.
- **Cancellation (HTL-21):** confirmed reservations only, as a whole, while today in the hotel's calendar is before the check-in date. Refund = the stored tier with the highest threshold not above the whole days left, applied to the full total and rounded down; 0% if no tier applies. A refund above 0 creates a pending `Refund` linked to the reservation's successful payment.

## Contract for Phase 9 (payments)

1. **Accept policies (PAY-02)** by setting `policyAcceptedAt` on the pending reservation.
2. **After Stripe confirms the payment**, call `HotelBookingLifecycleService.confirmPaidReservation(bookingId, { session })`, which `HotelBookingsModule` exports.
   - It requires a pending reservation with an unexpired hold and accepted policies.
   - It locks the rooms, sets a unique six-character reference, and sends the BOOKING_CONFIRMED notification.
3. **If confirmation fails** (for example the hold already expired), refund or reconcile the payment.
4. **Pending `Refund` records** from cancellations wait for Phase 9 to send them to Stripe (`TODO(PAY-03)`).

## Verification

Build, lint and formatting pass. 211 unit tests and 158 end-to-end tests pass on a local replica set (14 new). A browser Swagger check on a throwaway database covered:

- **Search:** public search, the guest-capacity filter, past dates refused.
- **Booking:** login required, a 2-room hold with children, a clashing room refused with nothing held, an overfull room refused, held rooms disappearing from search.
- **Viewing:** my reservations and details, a cancel refused while unpaid, and the hotel page not confused with `/search`.
