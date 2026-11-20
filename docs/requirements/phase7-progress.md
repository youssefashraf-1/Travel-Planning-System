# Phase 7 progress: hotel management and reviews

Source: official workbook HTL-01 to HTL-10, HTL-15, HTL-22 to HTL-24, GEN-11 and ACC-12, checked 2026-11-19. Prices are EGP minor units (piastres).

## Endpoints

| Endpoint                                           | Req              | Who                                                                                                                        |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/hotels`                                 | HTL-01           | Admin. The city must exist in the seeded reference data and belong to `countryCode`.                                       |
| `GET /api/hotels/:id`                              | HTL-02           | Public. Profile, policy, average rating, 5 newest reviews. With `checkInDate` and `checkOutDate` it also lists free rooms. |
| `PATCH /api/hotels/:id`                            | HTL-01           | That hotel's moderator                                                                                                     |
| `PUT /api/hotels/:id/policies`                     | HTL-09, HTL-10   | That hotel's moderator                                                                                                     |
| `GET /api/hotels/:id/rooms`                        | HTL-03 to HTL-06 | That hotel's moderator: every room, with its ranges                                                                        |
| `POST /api/hotels/:id/rooms`                       | HTL-03           | That hotel's moderator                                                                                                     |
| `PATCH /api/hotels/:id/rooms/:roomId`              | HTL-05, HTL-06   | That hotel's moderator (`isActive: false` deactivates)                                                                     |
| `DELETE /api/hotels/:id/rooms/:roomId`             | HTL-06           | That hotel's moderator; only for rooms that were never reserved                                                            |
| `POST /api/hotels/:id/rooms/:roomId/availability`  | HTL-04           | That hotel's moderator: add one bookable range                                                                             |
| `PATCH /api/hotels/:id/rooms/:roomId/availability` | HTL-05, HTL-06   | That hotel's moderator: replace bookable and/or blocked ranges                                                             |
| `GET /api/hotels/:id/availability`                 | HTL-08           | That hotel's moderator: per-day status, up to 62 days                                                                      |
| `GET /api/hotels/:id/rooms/available`              | HTL-15           | Public: free rooms with stay prices                                                                                        |
| `GET /api/hotels/:id/reservations`                 | HTL-22           | That hotel's moderator                                                                                                     |
| `POST /api/hotel-bookings/:id/review`              | HTL-23           | The traveler who owns the reservation                                                                                      |
| `PATCH` / `DELETE /api/reviews/:id`                | HTL-23           | The review's author                                                                                                        |
| `GET /api/hotels/:id/reviews`                      | HTL-24           | Public                                                                                                                     |

## Rules

- **Dates** are `YYYY-MM-DD` in the hotel's calendar (`timeZone`). A range or stay includes `fromDate` (the first night) and excludes `untilDate`, so a stay can begin the day another ends.
- **A room is free for a stay** (`roomIsFree`) when:
  - the room is active;
  - its bookable ranges cover every night (touching ranges count as one);
  - no blocked range overlaps the stay;
  - no occupying reservation overlaps it. Occupying means Confirmed, or Pending Payment with an unexpired hold.

  A deactivated hotel lists no free rooms.

- **Protected dates:** blocking dates, removing bookable dates and deactivating a room are refused while an occupying reservation that hasn't ended uses those dates. The error names the reservation. Deletion is refused if the room was ever reserved. Room price changes never affect stored reservations.
- **Calendar** day statuses: `booked` (Confirmed or Completed, with reference), `held`, `blocked`, `inactive`, `not_bookable`, `available`, checked in that order.
- **Policies** are sorted by threshold. A hotel `canBook` only when it is active and has policies.
- **Completed (GEN-11):** `HotelStayStatusService` marks a Confirmed reservation Completed once `checkOutDate` plus the stored `checkOutTime` has passed in the hotel's time zone. It runs at startup and every 30 seconds. Creating a review also completes the reservation on the spot if its check-out has passed.
- **Reviews:** one per reservation (unique `bookingId`), only by its owner, only when Completed. Rating 1–5, text up to 1000 characters. The average and count are calculated from visible reviews only (`hiddenAt` unset, for GEN-10), newest first, 10 per page. A deactivated author shows as "Deleted user" (ACC-12).

## Contract for Phase 8 (hotel booking)

`HotelsModule` exports `RoomsService` and `HotelStayStatusService`; `roomIsFree()` and `occupyingReservation()` are exported functions.

1. **Validate dates** with `RoomsService.checkStay(stay, hotel.timeZone, now)`: check-out after check-in, and check-in not before today in the hotel calendar (HTL-18).
2. **Inside the reservation transaction**, call `RoomsService.lockAvailability(roomIds, session)` first. It increments every booked room's availability version in room id order. Room edits, blocks and deactivation lock the same document, so they serialize with bookings.
3. **Then re-check each room inside the session.** It must belong to the hotel and pass `roomIsFree(...)`, counting overlapping occupying reservations with `occupyingReservation(now)`. If any room fails, reject the whole request (HTL-18).
4. **Copy into the booking:** each room's label, occupancy and nightly price; the hotel's `timeZone` and `policy`. The schema checks the total (nights × prices) and the occupancy.

## Verification

Build, lint and formatting pass. 209 unit tests and 144 end-to-end tests pass on a local replica set. A browser Swagger check on a throwaway database covered:

- **Admin:** hotel creation, plus a wrong country refused; creating the moderator.
- **Moderator:** first-login password change, policies, room, bookable dates, a block and the calendar.
- **Public:** free rooms with stay prices, a blocked stay excluded, details and reviews, and an edit without login refused.
