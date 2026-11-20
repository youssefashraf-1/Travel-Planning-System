import type { CookieOptions } from 'express';

/** ACC-05: five consecutive failed logins lock the account for 15 minutes. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;

/** ACC-06, ACC-19: a session ends after 30 minutes without activity. */
export const SESSION_INACTIVITY_MINUTES = 30;
export const SESSION_EXPIRED_MESSAGE =
  'Your session has expired. Please log in again.';

/** HttpOnly cookie carrying the short-lived signed access token (JWT). */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * HttpOnly cookie carrying the refresh token, used only by
 * POST /api/auth/refresh and /api/auth/logout to renew or end the session.
 * The server-side session decides whether it is still valid; the cookie's
 * own lifetime is just an upper bound for the browser.
 */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Both cookies are HttpOnly (page scripts cannot read them, so they are
 * never in localStorage), Secure (HTTPS only; browsers also allow it on
 * http://localhost) and SameSite=Strict (not sent by other websites).
 */
const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
};

export function accessTokenCookieOptions(): CookieOptions {
  return {
    ...baseCookieOptions,
    path: '/api',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  };
}

export function refreshTokenCookieOptions(): CookieOptions {
  return {
    ...baseCookieOptions,
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

/** Options for clearing a cookie must match the path it was set with. */
export function clearCookieOptions(
  options: CookieOptions,
): Omit<CookieOptions, 'maxAge'> {
  const { maxAge: _maxAge, ...rest } = options;
  return rest;
}
