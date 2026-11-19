import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * Marks a route that stays open while the user must change a temporary
 * password (ACC-07a, ACC-13). Every other protected route returns 403 until
 * the password is changed.
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);
