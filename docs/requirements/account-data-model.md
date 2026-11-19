# Account data model

The requirement IDs below refer to the [official workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513).

| Requirement | User data |
| --- | --- |
| ACC-01, GEN-13 | Name, normalized unique email, salted password hash and the acceptance time recorded at self-registration. Seeded or admin-created accounts can omit that timestamp. |
| ACC-04, ACC-12, ACC-15, ACC-16 | Traveler, administrator, airline moderator and hotel moderator roles. Accounts are active, suspended or deactivated. Guests have no account record. |
| ACC-05 | Consecutive failed login count and temporary lock expiry. The login service will lock the account for 15 minutes after five failures and reset the counter after a successful login. |
| ACC-07a, ACC-13 | A password-change flag for an admin reset or a moderator's first login. |
| ACC-09, ITN-18 | Optional phone and preferred currency. Currency codes are normalized to uppercase. The profile service will check them against the seeded list. No default currency is specified by the workbook. |
| ACC-13 | One provider ID for each moderator. The moderator role determines whether the ID refers to an airline or hotel. |
| ACC-14 | The creation timestamp supplies the registration date. |

When creating or changing a moderator assignment, the account service should verify that the provider exists in the collection corresponding to the role, then validate and save the role and provider ID together. The document validator checks the relationship between those fields. Keeping one ID on the user record allows an airline or hotel to have multiple moderators.

The registration service will validate the email, password and consent, set the traveler role and handle email conflicts from the database's unique index. The account service will enforce suspension and deactivation rules, including the restriction on deactivation when confirmed bookings are still upcoming.

## Session design for authentication

For ACC-06 and ACC-19, store each session separately under the auth feature. It should include a user ID, a refresh token digest, the last authenticated activity timestamp, an inactivity expiry timestamp and a revocation timestamp.

Set inactivity expiry to 30 minutes after the latest authenticated request. Check expiry and revocation before accepting or extending a session. Renew it only while it is still valid, and revoke it on logout before clearing its cookies. Use HTTP-only, Secure, SameSite cookies for both tokens.

Implemented in `backend/src/auth/`: the `Session` model stores the user ID, a SHA-256 digest of the refresh token, `lastActivityAt`, `expiresAt` and `revokedAt`. `JwtAuthGuard` checks and extends the session on every protected request in one atomic update. Each refresh token works once and is replaced on `POST /api/auth/refresh`. A TTL index removes sessions one day after they expire.
