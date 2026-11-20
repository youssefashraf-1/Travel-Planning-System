# Travel Planning and Booking Platform

GIU Software Project I (Winter 2026). A travel platform with flight and hotel booking, Stripe payments, itineraries with budgets, and a community blog.

| Milestone                   | Scope                                                               | Deadline    |
| --------------------------- | ------------------------------------------------------------------- | ----------- |
| **1: Backend and API**      | NestJS backend, MongoDB Atlas, Swagger documentation (this release) | 20 Nov 2026 |
| 2: Frontend and integration | Next.js frontend in `frontend/`                                     | 11 Dec 2026 |

The official requirements workbook (IDs such as `FLT-22`) is the source of truth. Swagger summaries name the requirement each endpoint covers.

## Contents

1. [Stack and structure](#stack-and-structure)
2. [Setup](#setup)
3. [Environment variables](#environment-variables)
4. [Seeding the database](#seeding-the-database)
5. [Running and using Swagger](#running-and-using-swagger)
6. [Demonstration walkthrough](#demonstration-walkthrough)
7. [API overview](#api-overview)
8. [API conventions](#api-conventions)
9. [Testing](#testing)
10. [Security](#security)
11. [Team workflow](#team-workflow)
12. [Further documentation](#further-documentation)

## Stack and structure

- **NestJS 12 + TypeScript** for modules, controllers, services, DTO validation (class-validator) and Swagger (`@nestjs/swagger`).
- **MongoDB Atlas + Mongoose 9**: one shared team database. Bookings and inventory use **transactions**, so the database must be a replica set; Atlas always is.
- **Stripe** (test mode) for payments and refunds. **FXRatesAPI** for itinerary currency conversion.
- **Auth:** JWT access and refresh tokens in **HttpOnly cookies** only, never in response bodies or JavaScript storage (ACC-19).

```text
Travel-Planning-System/
├── backend/
│   ├── src/
│   │   ├── main.ts, app/            # bootstrap, root module, global validation, Swagger
│   │   ├── auth/, users/, admin/    # accounts, sessions, roles, admin tools (ACC-*)
│   │   ├── airlines/, airports/, flights/, flight-bookings/        # FLT-*
│   │   ├── hotels/, hotel-bookings/, reviews/                      # HTL-*
│   │   ├── payments/                # Stripe payments, policies, refunds (PAY-*)
│   │   ├── itineraries/, exchange-rates/                           # ITN-*
│   │   ├── blog/, reports/, notifications/, audit-logs/            # BLG-*, GEN-*
│   │   ├── reference-data/          # seeded countries, cities, airports, currencies, demo data
│   │   └── common/                  # pagination, currency, validation, image uploads
│   ├── test/                        # end-to-end tests (real HTTP + MongoDB)
│   └── .env.example                 # every setting, without secrets
├── docs/                            # data model, authorization and per-phase notes
├── frontend/                        # Milestone 2
└── AI_PROMPTS.txt                   # AI assistance log
```

Each feature folder keeps its module, controllers, services, DTOs, schemas and unit tests together.

## Setup

**Requirements:**

- Node.js 22 or newer (developed on Node 24) and npm.
- Access to the team's MongoDB Atlas database.
- A Stripe account in test mode (a "sandbox").
- Docker, only for running the end-to-end tests.

```bash
cd backend
npm ci
cp .env.example .env
```

Fill in `backend/.env` as described below, seed the database once, then start the server.

## Environment variables

All settings live in `backend/.env`, which Git ignores. `backend/.env.example` lists them with blank or local example values.

| Variable                                      | Required         | Purpose                                                                                                                                                                                                               |
| --------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                 | yes              | The team's shared **MongoDB Atlas** connection string, from the team leader. Never commit it.                                                                                                                         |
| `JWT_ACCESS_SECRET`                           | yes              | Random secret of at least 32 characters for signing tokens, for example from `openssl rand -base64 48`.                                                                                                               |
| `PORT`                                        | no               | Defaults to `3000`.                                                                                                                                                                                                   |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | for `seed:admin` | The administrator created by seeding (ACC-18). The password needs 8+ characters with a letter and a digit.                                                                                                            |
| `STRIPE_SECRET_KEY`                           | for payments     | Stripe **test** secret key (`sk_test_…`) from <https://dashboard.stripe.com/test/apikeys>. Never use a live key.                                                                                                      |
| `STRIPE_WEBHOOK_SECRET`                       | optional         | `whsec_…` for `POST /api/payments/webhook`. Locally, `stripe listen --forward-to localhost:3000/api/payments/webhook` prints one. Without it, payments are still verified by asking Stripe (`GET /api/payments/:id`). |
| `FXRATES_API_KEY`                             | optional         | FXRatesAPI works without a key. Rates are fetched through the backend at most once a day and cached.                                                                                                                  |
| `UPLOADS_DIR`                                 | optional         | Where uploaded images are stored (default `backend/uploads`, ignored by Git). They are served at `/uploads/...`.                                                                                                      |
| `MONGODB_TEST_URI`                            | for e2e tests    | A **disposable local** database whose name contains `test`. The tests refuse to run otherwise.                                                                                                                        |
| `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`       | optional         | NestJS Observe monitoring.                                                                                                                                                                                            |

## Seeding the database

Run these from `backend/`. Each one is safe to run again.

```bash
npm run seed:reference   # official countries, cities, airports, attractions and currencies (GEN-12)
npm run seed:admin       # the administrator from ADMIN_* in .env (ACC-18); there is no admin sign-up
npm run seed:demo        # optional: 2 airlines, 30 flights (2–6 weeks ahead) and 3 hotels with rooms
```

- **`seed:reference`** loads the official reference datasets with their original identifiers, which the final evaluation uses.
- **`seed:demo`** creates no user accounts. Create airline and hotel moderators through Swagger as the admin. Re-run it before a demo so flights stay in the future.

## Running and using Swagger

```bash
npm run start:dev        # watch mode
npm run build && npm run start:prod
```

- **API:** `http://localhost:3000/api/...`
- **Swagger UI:** <http://localhost:3000/api/docs>; the raw OpenAPI file is at `/api/docs-json`.

**Logging in through Swagger:**

1. Call `POST /api/auth/login`. The browser stores the HttpOnly cookies, and every later "Try it out" call sends them automatically, so no token needs pasting.
2. Call `POST /api/auth/logout` to switch user.
3. Accounts created by an admin (moderators, and password resets) must call `PATCH /api/auth/change-password` first. Until then, other routes return 403.

## Demonstration walkthrough

With the reference data, admin and demo data seeded:

1. **Admin** (`POST /api/auth/login` with the seeded admin):
   1. `GET /api/admin/accounts`.
   2. Create a hotel moderator for _Nile View Hotel_ with `POST /api/admin/moderators` (hotel ids are in `GET /api/hotels/search` results).
   3. Optionally create an airline moderator for _Nile Air_.
2. **Traveler:**
   1. `POST /api/auth/register`, then log in.
   2. `GET /api/flights/search`: departure airport CAI and arrival DXB on a demo date. Airport ids come from `GET /api/airports`.
   3. `POST /api/flight-bookings` shows the price summary.
   4. `POST /api/flight-bookings/hold` reserves the seats for 10 minutes.
   5. `GET /api/bookings/flight/{id}/policies`, then `POST …/accept-policies` with `{ "accept": true }`.
   6. `POST /api/payments` with `{ "bookingType": "flight", "bookingId": "…", "testPaymentMethod": "pm_card_visa" }`. The booking is confirmed with a reference; `pm_card_chargeDeclined` shows a decline, and `POST /api/payments/{id}/retry` retries.
   7. `GET /api/flight-bookings/{id}/e-ticket` downloads the PDF. `POST /api/flight-bookings/{id}/cancel` with `{ "confirm": true }` sends the refund through Stripe; `GET /api/refunds/{id}` shows its status.
   8. Hotels: `GET /api/hotels/search?cityId=cairo&checkInDate=…&checkOutDate=…&guests=2`, then `POST /api/hotel-bookings`, accept the policies and pay the same way.
   9. Itineraries: `POST /api/itineraries`, add days, activities and budgets, then `GET /api/itineraries/{id}/budget-summary?currency=USD`. Set it public and search `GET /api/itineraries/public/search`.
   10. Blog: `POST /api/posts`, `POST /api/posts/{id}/like`, `POST /api/posts/{id}/comments`, `GET /api/tags/{tag}/posts`, `POST /api/reports`.
   11. `GET /api/notifications` shows the booking, refund and moderation notifications.
3. **Moderators:**
   - Hotel: `PATCH /api/auth/change-password`, then `GET /api/hotels/{id}/availability` and `GET /api/hotels/{id}/reservations`.
   - Airline: `GET /api/flights/{id}/bookings` and the CSV export.
4. **Admin moderation:**
   - `GET /api/admin/reports`, then `PATCH /api/admin/reports/{id}` with `{ "action": "hide", "confirm": true }`.
   - `PATCH /api/admin/providers/hotel/{id}/deactivate`, `GET /api/admin/bookings` and `GET /api/admin/audit-logs`.

## API overview

All paths start with `/api`. Swagger groups them by tag, with request and response schemas and every status code.

| Area                         | Main endpoints                                                                                                                                                                                                                                                                                                          | Requirements                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Accounts                     | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`; `GET /auth/me`; `PATCH /auth/change-password`; `GET/PATCH/DELETE /users/me`                                                                                                                                                                      | ACC-01–ACC-12, ACC-19          |
| Administration               | `POST /admin/moderators`; `GET /admin/accounts`; `PATCH /admin/accounts/:id/suspend\|reactivate`; `POST /admin/users/:id/reset-password`; `GET /admin/providers/:type`, `PATCH /admin/providers/:type/:id/deactivate\|reactivate`; `GET /admin/bookings`; `GET /admin/audit-logs`                                       | ACC-07a, ACC-13–ACC-18, GEN-07 |
| Airlines and flights         | `POST/GET/PATCH /airlines/:id`, `PUT /airlines/:id/baggage-policy\|cancellation-policy`; `GET /airports`; `POST /flights`, `GET /flights/search`, `GET/PATCH /flights/:id`, `POST /flights/:id/cancel\|cabins`, `PATCH /flights/:id/cabins/:cabinId`, `GET /flights/:id/bookings`, `GET /flights/:id/passengers/export` | FLT-01–FLT-17, FLT-29, FLT-30  |
| Flight booking               | `POST /flight-bookings`, `POST /flight-bookings/hold`, `GET /flight-bookings`, `GET /flight-bookings/:id`, `POST /flight-bookings/:id/cancel`, `GET /flight-bookings/:id/e-ticket`                                                                                                                                      | FLT-19–FLT-26                  |
| Hotels                       | `POST /hotels`, `GET /hotels/search`, `GET/PATCH /hotels/:id`, `PUT /hotels/:id/policies`, rooms (`/hotels/:id/rooms…`), availability, `GET /hotels/:id/availability\|reservations`                                                                                                                                     | HTL-01–HTL-15, HTL-22          |
| Hotel booking and reviews    | `POST/GET /hotel-bookings`, `GET /hotel-bookings/:id`, `POST /hotel-bookings/:id/cancel\|review`; `PATCH/DELETE /reviews/:id`; `GET /hotels/:id/reviews`                                                                                                                                                                | HTL-16–HTL-24                  |
| Payments                     | `GET /bookings/:type/:id/policies`, `POST /bookings/:type/:id/accept-policies`; `POST /payments`, `POST /payments/:id/retry`, `GET /payments/:id`, `POST /payments/webhook`; `GET /refunds/:id`                                                                                                                         | PAY-01–PAY-04                  |
| Itineraries                  | `/itineraries` CRUD, days (`/days`, `/days/reorder`), activities (+ images), budgets, transport costs, `/budget-summary`, `/public/search`, `/public/:id`, `/clone`, `/hotels`, `/flights`                                                                                                                              | ITN-01–ITN-26                  |
| Blog                         | `POST/GET /posts`, `GET /posts/search\|mine`, `GET/PATCH/DELETE /posts/:id`, `/posts/:id/images`, `/posts/:id/comments`, `PATCH/DELETE /comments/:id`, `POST/DELETE /posts/:id/like`, `GET /tags/:tag/posts`, `GET /authors/:id`                                                                                        | BLG-01–BLG-12                  |
| Moderation and notifications | `POST /reports`; `GET /admin/reports`, `PATCH /admin/reports/:id`; `PATCH /admin/content/:type/:id/hide`, `DELETE /admin/content/:type/:id`; `GET /notifications`, `/notifications/unread-count`, `PATCH /notifications/:id/read\|read-all`                                                                             | GEN-01, GEN-07–GEN-10          |

The blog was first built under `/api/blog/...`. Those addresses still work, but the paths above are the documented ones.

## API conventions

- **Errors:** `{ "statusCode", "message", "error" }`. Validation errors (400) list each field problem in `message`.
  - 401: not logged in or session expired.
  - 403: wrong role, not your provider, or a password change is required.
  - 404: not found, or someone else's private record.
  - 409: conflict with the current state, such as no seats left, a duplicate, or the wrong booking status.
  - 402: a declined card.
- **Pagination (GEN-05):** lists take `?page=` (from 1) and return `{ items, page, pageSize: 10, totalItems, totalPages }`.
- **Money (PAY-04):** whole numbers in the currency's minor unit (`…MinorUnits`). Prices, bookings, payments and refunds use **EGP** (piastres). Itinerary budgets may use any supported currency; JPY has no minor unit.
- **Dates and times (GEN-06):** times are stored in UTC and shown in each airport's or hotel's local time with its time zone. Hotel and itinerary dates are `YYYY-MM-DD` in the local calendar; a stay includes check-in and excludes check-out.
- **Booking lifecycle (GEN-11):** Pending Payment (10-minute hold) → Confirmed → Completed. A hold that runs out becomes Expired; a cancellation becomes Cancelled. A booking is confirmed only after Stripe reports the payment succeeded.
- **Confirmation bodies (GEN-03).** Destructive actions require an explicit body, and anything else returns 400:

| Body                                                             | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "confirm": true }`                                            | `POST /flight-bookings/:id/cancel`, `POST /hotel-bookings/:id/cancel`, `POST /flights/:id/cancel`, `PATCH /admin/providers/:type/:id/deactivate\|reactivate`, `DELETE /hotels/:id/rooms/:roomId`, `DELETE /hotels/:id/photos/:photoId`, `DELETE /airlines/:id/logo`, `DELETE /reviews/:id`, `DELETE /itineraries/:id`, `DELETE /itineraries/:id/days/:dayId`, `DELETE /activities/:id` (and `/images/:imageId`), `DELETE /budgets/:id`, `DELETE /transport-costs/:id`, `DELETE /posts/:id` (and `/images/:imageId`), `DELETE /comments/:id`, `PATCH /admin/content/:type/:id/hide`, `DELETE /admin/content/:type/:id` |
| `{ "currentPassword": "…", "confirm": true }`                    | `DELETE /users/me` (deactivate account)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `{ "accept": true }`                                             | `POST /bookings/:type/:id/accept-policies`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `{ "action": "dismiss" \| "hide" \| "delete", "confirm": true }` | `PATCH /admin/reports/:id` (also `POST /admin/reports/:id/resolve`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

- **Images (GEN-08):** `multipart/form-data` with field `image`. JPG or PNG only, checked by content; up to 5 MB, and up to 5 per post, activity or hotel (1 airline logo).

## Testing

Run from `backend/`:

```bash
npm run build
npm run lint
npx prettier --check src test
npm test -- --runInBand            # unit tests
```

End-to-end tests send real HTTP requests to the app and create and delete records, so they run only against a **local disposable** MongoDB replica set, never Atlas. They use a fake Stripe and fixed exchange rates, so they need no network:

```bash
docker run -d --rm --name tps-e2e-mongo -p 127.0.0.1:27018:27018 mongo:8.0 mongod --replSet tps-test --bind_ip_all --port 27018
docker exec tps-e2e-mongo mongosh --port 27018 --eval 'rs.initiate({_id:"tps-test",members:[{_id:0,host:"localhost:27018"}]})'
MONGODB_TEST_URI=mongodb://127.0.0.1:27018/travel_planning_system_test npm run test:e2e -- --runInBand
docker stop tps-e2e-mongo
```

The tests cover invalid input, 401, 403 by role and provider, ownership (404), concurrency (simultaneous holds never oversell; a room is never double-booked), payments, refunds and moderation. `docs/testing/phase13-api-boundaries.csv` lists the endpoint boundary checks.

## Security

- **Secrets:** `.env` is ignored by Git and has never been committed. The full Git history was scanned for keys and connection strings before this release.
- **Passwords:** stored only as salted scrypt hashes. Accounts lock for 15 minutes after 5 failed logins.
- **Sessions:** tokens live only in HttpOnly, Secure, SameSite cookies. A session ends after 30 minutes without activity, and logout revokes it.
- **Validation:** every rule is enforced on the server (GEN-13). Unknown fields are rejected.
- **Payments:** card details never reach the backend. Only the Stripe PaymentIntent id, amount, currency and status are stored. Webhooks are signature-checked.
- **Uploads:** checked by file content, size-limited, and served with `X-Content-Type-Options: nosniff`.

## Team workflow

- **Branches:** `feature/<REQ-ID>-<description>` from `develop`, then a pull request into `develop`. `develop` is merged into `main` at each milestone.
- **Commits:** Conventional Commits with requirement IDs, for example `feat(flights): implement search (FLT-11)`.
- **AI log:** material AI assistance is recorded in [`AI_PROMPTS.txt`](AI_PROMPTS.txt).

## Further documentation

- [Authorization rules](docs/authorization.md): roles, moderator ownership, owner-only records.
- [Database design](docs/requirements/database-design.md) and the data-model notes in `docs/requirements/`.
- Per-phase notes with the rules and contracts each phase follows: phases [5](docs/requirements/phase5-progress.md), [6](docs/requirements/phase6-progress.md), [7](docs/requirements/phase7-progress.md), [8](docs/requirements/phase8-progress.md), [9](docs/requirements/phase9-progress.md), [10](docs/requirements/phase10-progress.md), [11](docs/requirements/phase11-progress.md), [12](docs/requirements/phase12-progress.md) and [13](docs/requirements/phase13-progress.md).
