# Phase 13 — backend verification and documentation

## Status

Task 1 (automated testing and fixes) and Task 2 (documentation and release review) are complete.

## Validation — 20 November 2026

- Build, type-aware lint, formatting and Git whitespace checks passed.
- **238 unit tests in 42 suites passed.**
- **301 end-to-end tests in 21 suites passed.**
- Baseline before this task: 287 API tests. This task adds 14 API cases, including
  whole-API loops that make many HTTP requests within each case.
- Whole-API access checks exercised **128 documented operations**: 109 require
  login and return consistent HTTP 401 errors to guests; 19 intentionally allow
  guest access, including safe logout. Public requests may return successful,
  validation or missing-record responses depending on their inputs.
- A traveler was rejected with HTTP 403 on all **17 administrator operations**.
- The excluded Stripe webhook separately rejected unsigned input with HTTP 400.
  Existing payment tests verify Stripe signatures and duplicate event handling.
- Swagger HTML and JSON returned HTTP 200. Every login-required operation in the
  matrix declares cookie authentication. This is automated HTTP/contract evidence,
  not a claim that every successful workflow was clicked manually in Swagger.

The captured guest results are in
[phase13-api-boundaries.csv](../testing/phase13-api-boundaries.csv). The reusable
checks are `backend/test/api-boundaries.e2e-spec.ts`.

## Fixes and regressions

1. Refund status and notification are now one transaction. Previously a failed
   notification write left a final refund state, so subsequent delivery skipped
   the missing notification. Tests reproduce success/failure cases, verify rollback,
   and verify that duplicate retries produce exactly one notification.
2. Refund dispatch streams pending rows in stable id order with a cursor batch
   size of 100. Previously the first 100 remotely pending refunds could indefinitely
   block newer ones. A 101-refund test reproduced this before the fix.
3. Admin suspension/reactivation/password reset now commit account changes,
   session revocation, audit and relevant notifications together. Five injected
   failure cases verify unchanged account/password/session state and no partial
   audit/notification records when a dependent write fails.
4. Eight older delete operations now require `{ "confirm": true }`: itinerary,
   itinerary day, activity, activity image, budget entry, transport cost, room and
   review. Missing/false/string/null confirmation and unknown fields are rejected.
   Existing successful/ownership/referenced-room cases now send confirmation.
   Shared `ConfirmActionDto` also replaces the provider-media-specific DTO name.
5. Shared page validation rejects numbers whose ten-row offsets would exceed
   safe integer arithmetic. Invalid admin pagination returns HTTP 400 rather than
   being passed to MongoDB. Normal ten-row pagination remains passing.

Existing suites also check registration/login/session expiry, role and ownership
restrictions, concurrent seat/room holds, policy acceptance, flight/hotel booking
confirmation, e-tickets, declined-payment retry, expired holds, late capture,
provider cancellations, refund tiers/statuses, itineraries/budgets, community
visibility/moderation, notifications and uploaded-image permissions/limits.

## Reproduction

Run from `backend/`, with a disposable MongoDB replica-set database whose name
contains `test`. The existing test setup refuses the shared database and removes
Stripe keys; payment tests use a fake gateway with Stripe's real signature code.

```bash
npm run build
npm run lint
npm test -- --runInBand
MONGODB_TEST_URI='<disposable replica-set test URI>' npm run test:e2e -- --runInBand
```

Set `PHASE13_API_REPORT` to a local output file to capture the access matrix JSON.
No real Stripe transaction or shared Atlas record was used by this verification.

## Task 2: documentation and release review (done 20 November 2026)

- **README:** rewritten with setup, every environment variable, seed commands, uploads, the Swagger login flow, a demonstration walkthrough, an API overview, conventions (errors, pagination, money, dates, lifecycle), the table of required confirmation bodies, testing and security. `backend/README.md` now points to it.
- **Endpoint paths now follow the project description, section 8:**
  - The blog is served at `/api/posts`, `/api/comments/:id` and `/api/authors/:id`.
  - `GET /api/tags/:tag/posts` was added (BLG-08).
  - `PATCH /api/admin/reports/:id` was added (GEN-10), next to `POST …/resolve`.
  - The earlier `/api/blog/...` addresses still work through a small rewrite in `configure-app.ts`, so existing callers and tests are unaffected.
- **Swagger:**
  - Every operation now has a summary, including `GET /`.
  - The Stripe webhook is documented. It is public, and the Stripe signature protects it.
  - Optional search filters no longer carry example values, which Swagger's "Try it out" pre-fills and which silently filtered results: blog keyword and tag, hotel city, itinerary keyword and currency, admin booking and audit date ranges.
  - `test/milestone-paths.e2e-spec.ts` checks all of this, and the access matrix in `docs/testing/phase13-api-boundaries.csv` was regenerated with the documented paths.
- **Demo data:** `npm run seed:demo` adds 2 airlines, 30 flights (2–6 weeks ahead) and 3 hotels with rooms, for the Swagger demonstration. It is idempotent and creates no accounts.
- **Secrets:** the whole Git history was scanned for Stripe keys, webhook secrets, MongoDB credentials and JWT secrets, and none were found. `.env` was never committed, `.env.example` holds only placeholders, and uploads are ignored by Git.
- **Reference data:** identical to the official datasets (8 countries, cities, airports and attractions with the same identifiers).

Known, non-blocking: running `tsc` over the test files reports 46 type-only issues in older test helpers. Jest does not type-check, so every test still runs and passes. The application build (`npm run build`) and type-aware lint are clean.

Final verification: build, lint and formatting pass. 238 unit tests and 304 end-to-end tests pass.
