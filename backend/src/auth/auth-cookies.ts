import type { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
  clearCookieOptions,
  REFRESH_TOKEN_COOKIE,
  refreshTokenCookieOptions,
} from './auth.constants';

/** The tokens to put in cookies after login or refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export function readCookie(request: Request, name: string): string | undefined {
  return (request.cookies as Record<string, string> | undefined)?.[name];
}

/** Puts both tokens in HttpOnly cookies; the body never contains them. */
export function setAuthCookies(response: Response, result: AuthTokens): void {
  response.cookie(
    ACCESS_TOKEN_COOKIE,
    result.accessToken,
    accessTokenCookieOptions(),
  );
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    result.refreshToken,
    refreshTokenCookieOptions(),
  );
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(
    ACCESS_TOKEN_COOKIE,
    clearCookieOptions(accessTokenCookieOptions()),
  );
  response.clearCookie(
    REFRESH_TOKEN_COOKIE,
    clearCookieOptions(refreshTokenCookieOptions()),
  );
}
