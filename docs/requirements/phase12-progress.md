# Phase 12 — administration and support

## Scope and status

Phase 12 is complete for the mandatory backend scope. The user-approved Group A
covered provider activation, administrator bookings and audit history. The final
support work adds notification retrieval/read state and provider image uploads.
The original plan has no named Group A. Frontend screens follow in Milestone 2.

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
  notifications. The final support work now exposes notification listing/read APIs.
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

## Administrator endpoints

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

## Notifications and media endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/notifications` | Own inbox, newest first, ten/page; optional unread filter |
| GET | `/api/notifications/unread-count` | Own unread count |
| PATCH | `/api/notifications/:id/read` | Mark one own notification read, idempotently |
| PATCH | `/api/notifications/read-all` | Mark own currently unread notifications read |
| PUT | `/api/airlines/:id/logo` | Upload/replace the assigned airline's logo |
| DELETE | `/api/airlines/:id/logo` | Remove the logo with confirm:true |
| POST | `/api/hotels/:id/photos` | Upload one assigned hotel's photo |
| DELETE | `/api/hotels/:id/photos/:photoId` | Remove a photo with confirm:true |

- All notification endpoints require an active authenticated account, including
  admins and moderators. Each recipient accesses only their own inbox. Another
  recipient's notification id returns 404, even for administrators.
- Notifications cover booking confirmation/cancellation, refund updates, flight
  schedule changes and account/provider status changes using the existing event
  writers. Viewing the inbox never marks items read. Repeated marking preserves
  the original read timestamp. List totals and unread count use one aggregation.
- Uploads require the assigned moderator; guest, wrong-role, other-provider and
  suspended accounts are refused. Multipart field: `image`, one file/request,
  JPG/PNG detected from bytes, maximum 5 MB. Unexpected fields/files are rejected.
- Hotel additions enforce the five-photo cap atomically under concurrent uploads.
  Airline replacement keeps one logo. Removed/replaced files and failed writes'
  newly saved files are cleaned up. All uploaded images are served by URL.
- Hotel details retain `photoUrls` and now also expose `photos: [{id,url}]` for
  removal. Profile create/edit DTOs no longer accept `photoUrls` or `logoUrl`:
  use the upload endpoints, preventing arbitrary URL/path and limit bypasses.
  Existing stored URLs remain readable; no data migration is required.
- Blog/activity uploads already use the shared service and retain their five-image
  limits. Shared file copy/removal containment now requires a directory boundary,
  preventing access to sibling paths that share the uploads directory prefix.
- Files live under `UPLOADS_DIR` or `backend/uploads`; keep this directory when
  restarting or deploying if uploaded media must persist. No new credential is needed.

## Original Phase 12 checklist

| Checklist area | Completion evidence |
| --- | --- |
| Moderator assignment; administrator account management | Existing admin moderator/create/list/reset APIs and account API tests |
| Account suspension/reactivation | Existing guarded admin account APIs, session enforcement and notifications |
| Airline/hotel activation/deactivation | Group A provider operations, transaction/concurrency/payment tests |
| Administrator bookings | Combined read-only flight/hotel pagination and filters |
| Content reports management | Phase 11 reports and direct moderation, ownership/audit/rollback tests |
| Audit logs | Transactional admin action writers and read-only admin history |
| In-app notifications | All six event types, private inbox, unread count, single/all read operations |
| Image uploads and validation | Posts, activities, hotels and airline logo; byte type/size/count validation |
| Consistent errors and server-side validation | Shared Nest exception responses, DTO whitelist and invalid-input tests |
| Filtering, sorting and pagination | Validated list filters, stable documented ordering, ten items/page |
| Destructive confirmations | Existing admin/report/account confirmations plus provider/media removal DTOs |
| Permissions and errors | Full unit/API suites including role/ownership, suspended users and failure cleanup |

## Verification

- Build, type-aware lint, formatting and Git whitespace checks passed.
- **238 unit tests in 42 suites passed.**
- **287 end-to-end tests in 20 suites passed**, including 26 new notification/media
  cases and the 20 Group A administrator cases.
- New coverage includes all six event types, recipient isolation, read/unread
  filters, chronological pagination, idempotent single/all reads, suspended users,
  provider ownership, JPEG/PNG byte detection, missing/incorrect/oversized uploads,
  five-photo concurrency, concurrent logo replacement, file serving/removal,
  database-failure cleanup, raw URL rejection and sibling-path containment.
- Swagger UI returned HTTP 200; all eight notification/media operations expose
  cookie security, response schemas and multipart upload forms. Raw URL inputs
  are absent from create/edit request schemas. The Group A checks remain passing.

All tests used disposable local databases and fake payment state. Shared Atlas
records, private environment credentials, frontend files and main were preserved.

## Next

Phase 13: final backend demonstration, endpoint verification, documentation and
submission checks. Optional workbook bonus features remain separate from the
mandatory Phase 12 scope. Frontend pages remain Milestone 2 work.
