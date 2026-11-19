# Phase 5 progress

Source: official workbook FLT-01, FLT-02, FLT-03, FLT-04, FLT-08, FLT-09,
FLT-30 and GEN-05/06, checked 2026-11-19.

## Group 1: airlines and airports

- Admin creates airline profiles; public airline details; assigned airline
  moderator edits only name, code and logo URL. Code duplicates return 409,
  enforced by the existing unique index, including concurrent requests.
- Only the assigned moderator replaces extra-baggage and cancellation policies.
  Money uses safe integer minor units; thresholds are distinct nonnegative
  integers; percentages are 0–100. Empty tiers mean no refund. The eventual
  booking cancellation service must select the highest threshold no greater
  than days remaining (zero refund if none).
- Public read-only airport endpoint uses the seeded collection, literal search,
  country filter and ten-per-page pagination. No airport write endpoint.
- Routes and request/response DTOs are documented in Swagger.

## Handoff review

At develop 25a84b0, build, lint, formatting, 154 unit tests and 75 isolated local
MongoDB end-to-end tests passed. Code review checked authentication, session
revocation/rotation, roles, provider assignment and account actions. Existing
Mongoose `new` option deprecation warnings remain in the account code; Node
also reports its experimental VM-modules test runner warning. Passing tests
verify the covered flows, not a guarantee about all future integration.

Account deactivation visibility/anonymisation must still be integrated by the
future blog, itinerary and review read endpoints, as noted in the handoff.
The upcoming hotel-stay guard currently compares checkout with a UTC date;
it needs a hotel-time-zone boundary test when hotel booking is integrated.
No account code or schemas were changed by this flight work.

## Group 2: flight and cabin creation

- Airline moderators create flights for their assigned airline only. Request
  bodies cannot set airline, status or inventory counters. Airports must exist
  in the reference airport collection. Identical airports, invalid dates, past
  departures and arrival at/before departure in UTC return 400.
- Local input fields: `departureLocalDateTime`, `arrivalLocalDateTime`, both
  `YYYY-MM-DDTHH:mm` without an offset or Z suffix. Each airport's IANA time
  zone is used independently. Creation returns UTC timestamps plus local times
  and zones. Nonexistent and repeated daylight-saving times return 400 with an
  explanation rather than choosing a time silently.
- Flight number is normalized to uppercase without whitespace. The existing
  unique index enforces airline + number + departure local date, including
  concurrent requests. Duplicates return 409.
- Assigned airline moderators add cabins using `POST /api/flights/:id/cabins`.
  The fixed four classes are unique per flight, including concurrent creation.
  Seats and price are positive safe integers; free bag count is nonnegative;
  bag weight is positive. Held and booked counters start at zero; creation
  returns remaining seats. Booking holds and seat changes belong to Phase 6.
- `effectiveFlightStatus()` treats scheduled flights as departed at the exact
  departure instant. Cabin writes check it immediately. `FlightStatusService`
  persists scheduled-to-departed transitions at startup and every 30 seconds;
  cancelled flights are preserved. Future search/edit/booking services must
  also filter scheduled status AND `departureAt > now`, so persistence delay
  cannot allow a departed flight to be used.
- No existing schema, account code, dependencies or environment values changed.

## Validation

Build, lint and formatting pass. 174 unit tests and 86 end-to-end tests pass
against disposable local MongoDB. API tests cover flight UTC conversion,
invalid input, permissions, unknown records, concurrent duplicates, four cabin
classes, inventory validation, inactive airlines and departure status.
Unit tests cover winter/summer offsets, date rollover, leap days, fractional
hour zones and DST gaps/overlaps (including half-hour transitions).

A real browser Swagger smoke check on a separate disposable local database
verified cookie login, flight creation (201), cabin creation (201) and repeat
cabin rejection (409). No tests or seeding were run against shared Atlas.

## Group 3: public search and details

- `GET /api/flights/search`: required `departureAirportId`, `arrivalAirportId`,
  and `departureDate` (YYYY-MM-DD at the departure airport). Optional
  `returnDate` adds reverse-route return options, using that airport's local
  date. Returns `tripType`, `passengers`, `outbound` and, for round trips,
  `return`. Each leg has items/page/pageSize/totalItems/totalPages.
- `adults` defaults to 1, `children` and `infants` to 0. At least one adult,
  infants <= adults, and sufficient seats in one cabin for adults + children.
  Infants do not consume a seat. Birth-date/type validation, 10% infant fare
  calculation and a single two-segment booking/payment/reference are Phase 6
  work; search does not create a booking or calculate a final party quote.
- Only scheduled flights with departureAt > now from active airlines appear.
  Available seats are total - booked - held. Search never reserves seats.
  Empty searches return 200 with an empty list. Airport ids must exist in
  the reference collection; unknown/identical airports return 400.
- Optional `cabinClass`, inclusive `minPriceMinorUnits`/`maxPriceMinorUnits`.
  Prices are per adult/child cabin fare, not party totals. min > max returns
  400. Returned cabins satisfy every seat/class/price filter. A flight appears
  once even if several cabins qualify; price sorting uses the cheapest
  matching cabin. `sortBy` is price, duration or departureTime; `sortOrder`
  is asc/desc. Object id breaks ties for stable pagination (10 per leg).
  The same page, party and filters apply independently to both legs. Booking
  must check that a selected return departs after the selected outbound lands.
- `GET /api/flights/:id` is public and returns airline/policies, airports,
  UTC and local times/zones, duration, every cabin's fare, available seats and
  free baggage count/weight. Inactive, cancelled and departed flights remain
  viewable with canBook=false. Missing/malformed ids return 404. Internal
  held/booked counters are not exposed by the public read responses.
- Public read routes have their own controller, leaving moderator guards on
  the existing write routes. No account code, schemas or dependencies changed.
- Verified build, lint, formatting, 176 unit tests and 100 local MongoDB e2e
  tests. Coverage includes all sorts, pagination before/after filters,
  non-UTC local dates, wrong inputs, capacity, public and signed-in access,
  reverse-route options and Swagger schemas. Browser Swagger confirmed public
  search/details (200) and an inverted price range (400), without login.

## Groups 4 and 5: editing, cancellation and moderator views

- PATCH `/api/flights/:id`: owning airline moderator only; scheduled future
  flights only. Partial local-time/airport edits are validated together.
  Airports cannot change after ANY booking, including pending/expired ones.
  Local date is recalculated at the departure airport. Duplicate local-date
  flight numbers return 409. Time changes create one in-app notification per
  confirmed booking owner per change; submitting unchanged times does not.
- PATCH `/api/flights/:id/cabins/:cabinId`: owning moderator, matching flight
  and cabin, scheduled/future only. Updates fare, capacity and free baggage.
  Class, bookedSeats and heldSeats are server-controlled. The capacity write
  atomically requires new capacity >= booked + held. Booking fare snapshots
  stay unchanged. Cabin creation now uses the same transaction fence.
- POST `/api/flights/:id/cancel` requires `confirm: true`. One transaction
  cancels the flight, cancels confirmed bookings as whole round trips,
  expires pending bookings, releases all affected segments' actual seats
  (infants count zero), cancels pending local payment records and notifies
  booking owners. A failed inventory/payment precondition rolls everything
  back. Competing cancellation calls cannot double-release seats or duplicate
  notifications/refunds. A repeat completed cancellation returns 409.
- A succeeded payment matching the full booking amount/currency is required
  to queue a full refund. Existing partial refund records require explicit
  reconciliation (409). Full refund records are pending, never falsely marked
  refunded. **PAY-03 remains a Phase 9 integration dependency:** the dispatcher
  must issue Stripe refunds using idempotency, update pending/refunded/failed
  state and notify the owner. A pending record is not proof of a Stripe refund.
  Phase 9 must also cancel pending Stripe intents and reject late success
  webhooks from confirming expired/cancelled bookings; any late successful
  charge must be refunded/reconciled. No Stripe calls are made here.
- GET `/api/flights/:id/bookings`: only the owning moderator; confirmed and
  cancelled bookings, optional status filter, 10 per page. Returns reference,
  passenger names/types, cabin and seats for this segment, plus cabin inventory.
  Other-provider segments, DOB, passport/ID and contact data are omitted.
- GET `/api/flights/:id/passengers/export`: same authorization/filter, all
  matching passenger rows as downloadable CSV (page does not limit exports).
  Fields are quoted, quotes/newlines escaped, spreadsheet formula prefixes
  neutralized. Empty results still include a header row.

## Transaction contract for Phase 6

Mutation services use MongoDB transactions; Atlas supports this deployment
model. Full local e2e tests therefore need a replica set, not standalone MongoDB
(see README). Flight edits/cancellation/cabin changes first conditionally write
`__v` on the scheduled, future flight document, using it as a transaction fence.
**Phase 6 booking and hold creation must also conditionally write every involved
scheduled/future flight document inside the same transaction before changing
inventory or inserting the booking**. Use a consistent id order for multiple
flight documents. A read-only flight check is insufficient: without this
contract, a simultaneous booking insert could race with airport edits or flight
cancellation. Hold and booking state changes must stay atomic with counters.

## Final validation and status

Build, lint and formatting pass. 184 unit tests and 112 e2e tests run against a
fresh, local single-member replica set. Added checks cover all management routes,
401/403 by role/provider, invalid input, 404, booking fare snapshots, notified
schedule edits, transaction rollback, round-trip seat release, concurrent
cancellations, hold-versus-capacity races, infants, privacy and CSV safety.
Browser Swagger verified edit, cabin update, booking list, CSV export and
explicitly confirmed cancellation, plus rejection of confirm=false. The final
cancellation smoke response correctly reported one pending refund.

All Phase 5 endpoint groups are implemented. Do not mark FLT-06/PAY-03's full
refund outcome 100% verified until Phase 9 Stripe processing is implemented
and tested. Booking hold creation/expiry remains Phase 6; image upload/storage
is the separate Phase 12 GEN-08 feature (airline profiles currently accept URLs).

Next: Phase 6, flight booking and inventory holds, following the transaction
contract above. Do not promote develop to main as a completed backend milestone
until all remaining backend phases and their integration checks pass.
