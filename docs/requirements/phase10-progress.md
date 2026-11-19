# Phase 10 progress: itineraries and budgeting

Source: official workbook ITN-01 to ITN-26 (mandatory items), ITN-12 with GEN-08, ITN-18 and ACC-12, checked 2026-11-19. ITN-27 (link bookings) and ITN-28 (PDF) are optional and not implemented.

## Endpoints

**Owner endpoints** are for travelers only; other users get 404 (ACC-11).

| Area                            | Endpoints                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Itineraries (ITN-01, 03, 20)    | `POST/GET /api/itineraries`, `GET/PATCH/DELETE /api/itineraries/:id` (`visibility` is part of PATCH)                                                                                              |
| Days (ITN-05, 07, 08, 09)       | `POST /api/itineraries/:id/days`, `PATCH /api/itineraries/:id/days/reorder` (`{ dayId, position }`), `PATCH/DELETE /api/itineraries/:id/days/:dayId`                                              |
| Activities (ITN-10, 12)         | `POST /api/itineraries/:id/days/:dayId/activities`, `PATCH/DELETE /api/activities/:id`, `POST /api/activities/:id/images` (multipart field `image`), `DELETE /api/activities/:id/images/:imageId` |
| Budgets (ITN-14)                | `POST /api/itineraries/:id/days/:dayId/budgets`, `PATCH/DELETE /api/budgets/:id`                                                                                                                  |
| Transport (ITN-16)              | `POST /api/itineraries/:id/transport-costs` (with `dayId`), `PATCH/DELETE /api/transport-costs/:id`                                                                                               |
| Budget (ITN-14, 18)             | `GET /api/itineraries/:id/budget-summary?currency=`                                                                                                                                               |
| Clone (ITN-21)                  | `POST /api/itineraries/:id/clone`                                                                                                                                                                 |
| Hotels and flights (ITN-25, 26) | `GET /api/itineraries/:id/hotels?group=&guests=&rooms=`, `GET /api/itineraries/:id/flights?originAirportId=&tripType=`                                                                            |

**Public endpoints**, no login needed:

- `GET /api/itineraries/public/search` (ITN-21): `keyword`, `countryCode`, `cityId`, `minDays`, `maxDays`.
- `GET /api/itineraries/public/:id?currency=` (ITN-21).

## Rules

- **Itineraries:** title up to 100 characters, seeded countries, private by default.
  - Removing a country that some days use is refused.
  - Deleting an itinerary deletes its images. Clones are separate documents and keep their own copies.
- **Days:** each needs a seeded city in one of the itinerary's countries. At most 60.
  - Numbers and dates (start date + position) are worked out on read, so deleting, moving or changing the start date updates them at once.
  - Consecutive days in the same city form numbered groups.
- **Concurrency:** every change is saved with Mongoose's version check, so two edits at once return 409 instead of silently overwriting each other.
- **Money:** amounts are non-negative whole numbers in each currency's minor unit, and currencies must be supported (seeded list). JPY has no minor unit, so 1 JPY is stored as 1, while EGP is stored in piastres.
- **Budget summary:**
  - Categories: food, accommodation, in-city transport, activities (budget entries plus activity costs) and intercity transport.
  - Totals are given by category, day and city group.
  - Display currency: `?currency=`, otherwise the user's preferred currency, otherwise EGP.
- **Exchange rates (ITN-18):** fetched from FXRatesAPI by the backend, base EGP.
  - Fetched at most once every 24 hours and cached in `exchangerates`.
  - If the API fails, the last cached rates are used (`ratesAreCached: true`). With no cache at all, the result is 503.
  - Unknown currencies return 400.
  - `FXRATES_API_KEY` is optional and never leaves the server.
  - Bookings are not converted (PAY-04).
- **Images (GEN-08, shared):** `src/common/uploads/image-uploads.service.ts`.
  - JPG or PNG, detected by content; up to 5 MB (413); 5 per activity.
  - Stored under `backend/uploads/` (or `UPLOADS_DIR`), which Git ignores, and served at `/uploads/...` with `nosniff`.
  - Posts and hotels can reuse this service in phases 11 and 12.
- **Public view:** only public itineraries that are not hidden (GEN-10) and whose author is not deactivated (ACC-12).
  - Keyword search matches the title, a country code or name, or a city id or name.
  - The view includes the author, days, activities and budget.
- **Clone:** a deep, private copy with new ids and copied image files. `clonedFrom` stores the source and credits the original author, even for a clone of a clone.
- **ITN-25:** hotel search (HTL-11) for a city group. Check-in is the group's first date; check-out is the day after its last date.
- **ITN-26:** flight search (FLT-11, FLT-12) from an origin to every airport in day 1's city. Departure defaults to the start date; a round trip returns on the last day's date by default.

## Verification

- **Checks:** build, lint and formatting pass. 233 unit tests and 174 end-to-end tests pass (9 new itinerary test groups with a stubbed FXRatesAPI).
- **Real FXRatesAPI check** through Swagger on a throwaway database:
  1. Created an itinerary over 3 days in Cairo and Paris, with groups.
  2. The budget came out in USD (preferred currency) and in EGP, and a fake currency was refused.
  3. A photo uploaded, was served by URL, and a fake image was rejected.
  4. Moving a day renumbered the days, and the itinerary went public.
  5. A guest found it by searching and viewed it with the budget in EUR.
  6. Another user's clone was private and credited the author, and that user's edit of the original returned 404.
