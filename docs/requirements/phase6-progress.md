# Phase 6 progress: flight booking and inventory

Source: official workbook FLT-12, FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-26 and GEN-11, checked 2026-11-19. All amounts are in **EGP** minor units (piastres): `PLATFORM_CURRENCY` in `src/common/currency.ts`.

## Endpoints (travelers only)

| Endpoint                                                   | Req            | What it does                                                                                         |
| ---------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /api/flight-bookings`                                | FLT-19, FLT-21 | Checks flights, cabins, passengers and extra bags, then returns the price summary. Reserves nothing. |
| `POST /api/flight-bookings/hold`                           | FLT-22         | Same body. Reserves the seats and creates a Pending Payment booking that lasts 10 minutes.           |
| `GET /api/flight-bookings?group=upcoming\|past\|cancelled` | FLT-25         | The traveler's own bookings, 10 per page.                                                            |
| `GET /api/flight-bookings/:id`                             | FLT-25, FLT-26 | Full details. A confirmed booking also shows the refund a cancellation would give now.               |
| `POST /api/flight-bookings/:id/cancel`                     | FLT-26         | Needs `{ "confirm": true }`. Only allowed before the outbound flight departs.                        |
| `GET /api/flight-bookings/:id/e-ticket`                    | FLT-23         | PDF for confirmed and completed bookings.                                                            |

Anyone but the owner gets 404 (ACC-11). Passport and ID numbers are stored, but only their last four characters are ever returned.

## Rules

- **Passenger types** are checked against the date of birth on each flight's local date: adult 12+, child 2–11, infant under 2. The declared type must match the outbound date. Each flight needs an adult, and can't have more infants than adults. Infants pay 10% of the fare (rounded) and take no seat.
- **Extra bags:** up to the airline's maximum per passenger per flight, each no heavier than the cabin's bag weight limit. Fee = bags × the airline's price per bag. Return-flight bags need a return flight.
- **Round trips:** the return flight must fly the reverse route and leave after the outbound flight lands. Both legs are one booking, one total and one reference, and they're cancelled together.
- **Snapshot:** the fare, bag terms and cancellation tiers are copied into the booking when the seats are held. Later airline changes don't affect it.
- **Holds (FLT-22):** inside one transaction, each flight is fence-written in id order (the phase 5 contract), then each cabin is incremented with a single conditional update that requires `total − booked − held ≥ seats`. The end-to-end test sends 8 simultaneous holds at a 3-seat cabin: exactly 3 succeed.
- **Expiry:** `FlightBookingLifecycleService` sweeps every 30 seconds and at startup. Holds are also expired before any search for seats on those flights, and before the traveler's lists and details. Expiring is idempotent and releases seats only once. Local pending payments for an expired booking are marked cancelled.
- **Completed (GEN-11):** the same sweep marks a confirmed booking Completed once every flight in it has landed.
- **Cancellation refund (FLT-09, FLT-26):** the outbound segment's stored tiers. The tier with the highest threshold not above the whole days left decides the percentage of the whole booking total, rounded down; 0% if no tier applies. A refund above 0 creates a pending `Refund` linked to the booking's successful payment.

## Contract for Phase 9 (payments)

1. **Accept policies (PAY-02)** by setting `policyAcceptedAt` on the pending booking. Confirmation refuses a booking without it.
2. **After Stripe confirms the payment**, call `FlightBookingLifecycleService.confirmPaidBooking(bookingId, { session })`. Pass your transaction's session so the payment record and the confirmation commit together.
   - It requires a pending booking with an unexpired hold and accepted policies.
   - It fence-writes the flights, moves held seats to booked seats, sets a unique six-character reference, and sends the BOOKING_CONFIRMED notification.
   - `FlightBookingsModule` exports this service.
3. **If confirmation fails** (for example the hold expired before the webhook arrived), the payment must be refunded or reconciled. Never confirm it another way.
4. **Pending `Refund` records** come from traveler cancellations (here) and airline cancellations (phase 5). Phase 9 sends them to Stripe and updates their status (`TODO(PAY-03)`).

## Verification

Build, lint and formatting pass. 199 unit tests and 133 end-to-end tests pass on a local single-member replica set. A browser Swagger check on a throwaway database covered the price summary with local times, a wrong passenger type (400), holds up to the cabin limit then 409, the upcoming list, masked document numbers, the pending e-ticket and cancel refusals (409), and logout (401).
