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

## Next

Group 3: flight search and details (FLT-11, FLT-12, FLT-15, FLT-17).
Then editing/cancellation, then moderator booking views. Phase 5 is not yet
complete. Cabin editing and reservation/hold management are not included in
these two groups.
