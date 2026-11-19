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

## Next

Group 2: flight/cabin creation and time conversion.
Then search/details, then editing/cancellation, then moderator booking views.
