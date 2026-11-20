# Phase 11 — Blog & Community

> **Paths (Phase 13):** the blog endpoints are documented at `/api/posts`, `/api/comments/:id`, `/api/authors/:id` and `/api/tags/:tag/posts`, as in the project description. The `/api/blog/...` paths used below still work.

**Status: all mandatory Phase 11 backend functionality is implemented and verified.**
Source: official project workbook, checked 20 November 2026. Group A was merged
through PR #27; this document describes the final combined implementation.
Frontend pages and navigation belong to Milestone 2.

## Completed requirements

- [x] BLG-01: required title/body, optional tags/images, draft or published; published posts appear in search and on the public author page.
- [x] BLG-02: public published-post browsing, tag filter, paginated results, post details with author/date/body/tags/images/counts and chronological comments.
- [x] BLG-03: author-only post list including drafts, dates, status and interaction counts.
- [x] BLG-04: author-only post editing/deletion and draft/publish transitions.
- [x] BLG-05: logged-in comments, nonblank text up to 500 characters, chronological pagination.
- [x] BLG-06: logged-in like/unlike, one like per user/post, safe repeated requests.
- [x] BLG-07: author-only comment editing and confirmed deletion.
- [x] BLG-08: up to five distinct normalized tags of up to 30 characters, editable and filterable/searchable.
- [x] BLG-09: literal keyword search in title/tags/author name; excerpts; likes plus visible comments descending, newest publication first for ties.
- [x] BLG-10: upload/remove JPG/PNG images, maximum five per post and 5 MB per file.
- [x] BLG-12: public author name/join date, published visible posts and public visible itineraries, with independent pagination.
- [x] GEN-09: report posts, comments, reviews and public itineraries with a reason; one report per reporter/item across its lifetime.
- [x] GEN-10: admin report lists/resolution, inspection, direct hiding/deletion, author/admin-only access to hidden content.
- [x] GEN-07: audit records for content moderation and report dismissal, saved atomically with the decision.
- [x] GEN-03/05/08/13 and ACC-12: confirmations, ten-per-page lists, upload validation, backend authorization and deactivated-author visibility/anonymization.

The optional **BLG-13 itinerary attachment to a post** is not implemented. It is
not needed to complete the mandatory Phase 11 backend scope.

## Endpoints

All paths below start with `/api`. Swagger groups them under Blog posts,
Blog community, Blog authors, Content reports and Content moderation.

| Endpoint | Access and purpose |
| --- | --- |
| `GET /blog/posts?page=&tag=` | Public published posts, newest first |
| `GET /blog/posts/search?keyword=&tag=&page=` | Public ranked search; `items: []` for no results |
| `GET /blog/posts/:id?page=` | Public post details; page selects chronological comments |
| `GET /blog/posts/mine?page=` | Own posts, including drafts/hidden posts |
| `GET /blog/posts/mine/:id` | Own complete post |
| `POST /blog/posts` | Registered user: title/body, optional status/tags |
| `PATCH /blog/posts/:id` | Author edits or changes draft/published status |
| `DELETE /blog/posts/:id` | Author; `{ "confirm": true }` |
| `POST /blog/posts/:id/images` | Author; multipart `image` |
| `DELETE /blog/posts/:id/images/:imageId` | Author; `{ "confirm": true }` |
| `GET /blog/posts/:id/comments?page=` | Public chronological comments |
| `GET /blog/comments/mine?page=` | Own comments, including hidden comments |
| `POST /blog/posts/:id/comments` | Registered user; `{ "body": "..." }` |
| `PATCH /blog/comments/:id` | Comment author; `{ "body": "..." }` |
| `DELETE /blog/comments/:id` | Comment author; `{ "confirm": true }` |
| `POST /blog/posts/:id/like` | Registered user; idempotent like, returns liked/count |
| `DELETE /blog/posts/:id/like` | Registered user; idempotent unlike, affects only own like |
| `GET /blog/authors/:id?page=&itinerariesPage=` | Public author, independently paginated posts/itineraries |
| `POST /reports` | Registered user; targetType, targetId, reason |
| `GET /content/mine/:type/:id` | Owner inspection, including hidden content |
| `GET /admin/reports?status=&page=` | Admin; open by default, optional status filter |
| `POST /admin/reports/:id/resolve` | Admin; action dismiss/hide/delete and confirm:true |
| `GET /admin/content/:type/:id` | Admin inspection, including hidden content |
| `PATCH /admin/content/:type/:id/hide` | Admin; confirm:true |
| `DELETE /admin/content/:type/:id` | Admin; confirm:true |

`type`/`targetType`: `post`, `comment`, `review` or `itinerary`.
Report reasons must be nonblank and at most 1000 characters. Bodies are text,
not trusted HTML. The server controls identities, dates and moderation fields.
Public reads never return account emails/password data.

## Visibility and authorization

- Every active registered role can write its own blog content; existing login,
  suspension/deactivation and temporary-password guards apply.
- Guests can read published visible posts/comments and author pages. Restricted
  actions return 401; the frontend will implement login-and-return navigation.
- Non-owner edits/deletes return 404; admin moderation uses separate role-guarded
  routes. Airline/hotel moderators cannot use administrator moderation routes.
- Public reads and pagination totals exclude drafts, hidden posts, and posts or
  author pages of deactivated/missing accounts. Public author pages also exclude
  private/hidden itineraries.
- Hidden comments disappear from public comments/counts and search interaction
  scores. Their author can read them through own-comment/content endpoints.
- Deactivated/missing commenters are shown as `Deleted user`, without an author
  id. Their visible comments remain. Existing review anonymization is retained.
- Authors can inspect their hidden posts/comments/reviews/itineraries; admins can
  inspect any of those content types. Other users cannot inspect hidden items.
- Text/status edits never remove moderation hiding. Returning a post to draft
  clears its publication date; republishing sets a new date. Ordinary edits keep it.

## Consistency and moderation

- The unique like/report indexes remain authoritative. Repeated likes/unlikes
  are safe; duplicate reports return 409, even after an earlier report resolves.
- Community writes and report creation use a parent-post transaction fence.
  Concurrent post edits, hiding and deletion cannot create orphan interactions.
  Existing optimistic post saves retain 409 conflict handling and upload cleanup.
- Character limits match between request validation and schemas, including
  Unicode characters, avoiding schema failures for valid Unicode input.
- Admin content changes, related open-report resolutions and audit records are
  one transaction. A failed audit write rolls back the whole moderation action.
  Competing decisions on one report result in one success and one 409.
- Direct hiding is idempotent. An author editing a hidden item cannot unhide it.
- Deleting a post removes comments/likes; open reports about its child comments
  are also marked content_deleted. Post/activity images are removed after the
  database transaction commits. Other authors' independent itinerary clones remain.
- If an author already deleted reported content, the admin can dismiss the stale
  report. Hiding absent content returns 404 without falsely recording a deletion.
- Requires a MongoDB replica set, as do the existing booking transactions.

## Verification

- Build, type-aware lint, formatting and Git whitespace checks passed.
- **238 unit tests in 42 suites passed.**
- **241 end-to-end tests in 18 suites passed**, including 34 new community,
  discovery and moderation cases plus the existing 28 Group A cases.
- Coverage includes guest/role/ownership checks, suspended accounts, Unicode and
  invalid input, chronological pagination, duplicate/concurrent likes/reports,
  search ranking/ties, author privacy, deleted-user labels, every reportable
  content type, moderation/audit rollback, competing decisions and media cleanup.
- Swagger browser smoke: real ranked search returned HTTP 200 with the visible
  Cairo post, one like, one comment and interaction score 2; its draft was absent.
- OpenAPI validation checked all **25** blog/community/report/moderation operations,
  their public/authenticated access declarations, and embedded public comments.

All verification used disposable local databases. Shared Atlas data, private
`.env` credentials, frontend files and `main` were preserved.

## Next

Continue with the remaining Phase 12 administration/support work, then Phase 13
final backend checks and submission documentation. Reporting/moderation and its
audit-writing portion are already supplied here; the remaining Phase 12 audit
listing and other supporting APIs still need their own implementation/review.
