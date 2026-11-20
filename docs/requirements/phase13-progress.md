# Phase 13 — backend verification and documentation

## Status

Task 1 (automated testing and fixes) is complete. Task 2 (documentation and final
milestone review) remains. This report does not declare Milestone 1 finished.

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

## Task 2 remains

- Replace the starter README with project setup, demonstration and API guidance.
- Document environment variables, seed commands, uploads and test configuration.
- Check required endpoint documentation and prepare the Swagger demonstration.
- Document the confirmation-body changes for API consumers.
- Verify current files and Git history for environment/secret exposure and resolve
  any findings; prepare final backend milestone evidence and release review.
