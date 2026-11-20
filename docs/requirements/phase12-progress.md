# Phase 12 — administration and support

## Group A scope and status

Group A is the user-approved grouping for provider activation, read-only
administrator booking lists and audit history. The original plan has no named
Group A. Notifications retrieval and remaining uploads are later work.

## Implemented

- ACC-15: administrators list airlines/hotels, filter by active status or literal
  name search, and deactivate/reactivate a provider with `confirm: true`.
- Provider status, audit entry, pending-hold deadlines and notifications commit
  in one transaction. Confirmed bookings remain valid and unchanged. Existing
  searches exclude inactive providers and new bookings are rejected.
- New flight/hotel holds serialize against provider deactivation. Pending holds
  end immediately; existing lifecycle jobs perform expiry and inventory release.
  Reactivation never restores an ended hold or changes moderator account status.
- Affected booking owners and assigned moderators receive stored, deduplicated
  notifications. The notification listing/read APIs are not part of this group.
- Stripe work stays in the existing payment lifecycle: ended holds cannot confirm;
  late captured payments enter its durable full-refund queue. The status-change
  request does not wait for Stripe cancellation/refund dispatch.
- ACC-17: one read-only page combines flight and hotel bookings, with type, status
  and inclusive travel start-date filters. Flight dates use the outbound airport's
  local departure date; hotel dates use check-in. Results include reference, user,
  providers, dates, amount and status, excluding passports and payment secrets.
- GEN-07: read-only audit history, filtered by action, actor, target model/id and
  inclusive UTC calendar dates. No audit-edit/delete endpoints are exposed.
- Lists use ten items per page and stable ordering. Invalid dates, reversed ranges,
  unsafe page offsets, unknown fields and missing confirmation are rejected.
- Existing account/moderator creation, listing, suspension/reactivation and reset
  functionality is retained and checked through the existing API suites. Provider
  inactivity remains separate from moderator account suspension. Phase 11 already
  supplies reporting/moderation and its audit writes.

## New endpoints

All five require an active administrator session.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/providers/:type` | List airlines or hotels |
| PATCH | `/api/admin/providers/:type/:id/deactivate` | Deactivate provider |
| PATCH | `/api/admin/providers/:type/:id/reactivate` | Reactivate provider |
| GET | `/api/admin/bookings` | Combined booking list |
| GET | `/api/admin/audit-logs` | Audit history |

`:type` is `airline` or `hotel`. PATCH bodies are `{ "confirm": true }`.
Booking date filters are `fromDate`/`toDate`; they refer to travel, not creation.
Audit date filters refer to UTC creation dates. Swagger documents these contracts.

## Verification

- Build, type-aware lint, formatting and Git whitespace checks passed.
- **238 unit tests in 42 suites passed.**
- **261 end-to-end tests in 19 suites passed**, including 20 new Group A cases.
- Coverage includes all new endpoints' administrator-only access, independent
  moderator/provider status, deactivation/reactivation, notification deduplication,
  unchanged confirmed bookings, ended holds, audit/notification rollback,
  concurrent status changes and hotel holds, late-payment full-refund queuing,
  private-field exclusion, combined pagination and travel/UTC date boundaries.
- Swagger UI returned HTTP 200. All five new operations expose documented
  cookie security and response schemas; a guest booking-list request returned 401.

Tests used a disposable local replica-set database and no real Stripe account.
Private environment files, shared Atlas records and frontend files were preserved.

## Remaining

Finish the later Phase 12 support work: notification listing/unread/read APIs and
remaining upload requirements, then Phase 13 final backend verification and
submission documentation. Group A does not complete all of Phase 12.
