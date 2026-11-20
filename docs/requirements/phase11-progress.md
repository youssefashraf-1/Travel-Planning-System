# Phase 11 — Blog & Community

Source: current official workbook, downloaded and checked 20 November 2026.
Group A scope was confirmed by the user: post creation, drafts/publishing,
viewing, editing and deletion. Tags and image attachments are included in the
post contract required by BLG-01. Comment/like interaction, keyword search,
public author pages, reporting and moderation remain for later groups.

## Group A: core posts

- [x] Wire the existing Blog module to its controllers/services.
- [x] Create a post with required nonblank title/body, draft by default or published (BLG-01).
- [x] Publish/unpublish, with server-owned author and publication timestamps.
- [x] Public paginated published-post list and post content (core BLG-02).
- [x] Author-only list and detail including drafts, dates, status and counts (BLG-03).
- [x] Author-only editing and confirmed deletion (BLG-04, GEN-03).
- [x] Up to five normalized, distinct tags of up to 30 characters; tag filtering (BLG-08).
- [x] Upload/remove up to five JPG/PNG images, at most 5 MB each (BLG-10, GEN-08).
- [x] Swagger request/response documentation and isolated database regression tests.

BLG-02 is **partial overall**: the public post content and counts work, but
comment display/interaction is not implemented in Group A. BLG-01's search and
public author-blog integration will be verified when BLG-09/12 are added.
No frontend pages are implemented here.

## Endpoints

All paths start with `/api/blog/posts`.

| Method and suffix | Access | Purpose |
| --- | --- | --- |
| `GET /?page=1&tag=egypt` | Public | Published visible posts, newest first, ten per page |
| `GET /:id` | Public | Published visible post details |
| `GET /mine?page=1` | Logged-in author | Own posts, including drafts and hidden posts |
| `GET /mine/:id` | Logged-in author | Own complete draft/published post |
| `POST /` | Any active registered user | Create with title/body, optional status/tags |
| `PATCH /:id` | Author only | Edit title/body/tags or draft/published status |
| `DELETE /:id` | Author only | Delete with `{ "confirm": true }` |
| `POST /:id/images` | Author only | Multipart upload, field `image` |
| `DELETE /:id/images/:imageId` | Author only | Remove image with `{ "confirm": true }` |

The server owns author identity, moderation fields and timestamps. Arbitrary
image URLs are not accepted; upload after creating the post. Body content is
text, not trusted HTML. Images have ids and URLs in the response.

## Rules and integration

- Every registered role can write its own posts; no traveler-only restriction.
- Existing login/session/account-status/password-change guards apply.
- Non-owner writes return 404, including admins using the author endpoints.
  Administrative moderation will have separate endpoints in a later group.
- Public reads exclude drafts, hidden posts and deactivated/missing authors
  (ACC-12, GEN-10), including their contribution to pagination totals.
- Authors can still read their own hidden posts, but edits cannot unhide them.
- Title/body whitespace and null values, malformed status/tags, duplicate tags
  after trimming/lowercasing, and unknown/server-controlled fields return 400.
- Returning to draft clears the publication date. Republishing assigns a new
  date; ordinary edits preserve it.
- Like/comment counts read existing collections; hidden comments are excluded.
  These counts are ready for the later interaction endpoints.
- Optimistic version checks prevent overlapping edits from silently replacing
  each other. Conflicts return 409; competing uploads cannot exceed five images.
  Failed concurrent uploads clean up their unused files.
- Deleting a post and its existing comments/likes is one MongoDB transaction.
  Its image files are cleaned up afterward. A replica set is required, as for
  the existing booking transactions.

## Remaining Phase 11 work

- Comments, chronological display, comment ownership/edit/delete (BLG-05/07).
- Like/unlike, duplicate prevention (BLG-06).
- Keyword search with interaction-score ordering (BLG-09).
- Public author pages with published posts and public itineraries (BLG-12).
- Reporting, admin report resolution, hiding/deletion and audit integration
  (GEN-07/09/10).
- Optional itinerary attachments (BLG-13) are not part of Group A.

## Verification

- Build, type-aware lint and formatting checks passed.
- Full unit suite: **238 tests in 42 suites passed**.
- Full end-to-end suite: **207 tests in 17 suites passed**, including 28 new
  Group A tests covering malformed/server-controlled fields, all registered
  roles, draft privacy, ownership, publish/unpublish timestamps, pagination,
  hidden/deactivated content, image limits/cleanup, confirmed deletion and
  concurrent edits/uploads.
- Swagger browser smoke check: public list returned HTTP 200 with a correctly
  paginated empty response on a separate local database. The OpenAPI document
  exposes nine Blog operations; two public reads and seven authenticated
  owner operations, with required deletion confirmation.

Tests use `MONGODB_TEST_URI` pointing to a disposable local replica set.
Shared Atlas records and private `.env` settings are not changed by these tests.
