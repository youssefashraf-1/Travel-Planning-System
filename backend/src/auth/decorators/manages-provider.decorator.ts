import { SetMetadata } from '@nestjs/common';
import { ProviderType } from '../access';

export const MANAGES_PROVIDER_KEY = 'managesProvider';

export interface ManagesProviderOptions {
  type: ProviderType;
  /** The route parameter that holds the airline or hotel id. */
  param: string;
}

/**
 * Limits a route to the moderator of the airline or hotel named in the URL.
 * Use with JwtAuthGuard and ProviderOwnerGuard, for example:
 *
 *   @Patch(':id')
 *   @UseGuards(JwtAuthGuard, ProviderOwnerGuard)
 *   @ManagesProvider(ProviderType.AIRLINE)
 *
 * Pass the parameter name when it is not "id".
 */
export const ManagesProvider = (type: ProviderType, param = 'id') =>
  SetMetadata(MANAGES_PROVIDER_KEY, { type, param } as ManagesProviderOptions);
