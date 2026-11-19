import type { CookieOptions } from 'express';

/** ACC-05: five consecutive failed logins lock the account for 15 minutes. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;

/** Name of the HttpOnly cookie that carries the signed access token (JWT). */
export const ACCESS_TOKEN_COOKIE = 'access_token';

/**
 * Lifetime of one access token. The 30-minute inactivity session and its
 * refresh token (ACC-06, ACC-19) are added separately.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The browser keeps the token in an HttpOnly cookie, so page scripts cannot
 * read it (never in localStorage). Secure limits it to HTTPS, which browsers
 * also allow on http://localhost. SameSite=Strict blocks cross-site requests.
 */
export function accessTokenCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  };
}
