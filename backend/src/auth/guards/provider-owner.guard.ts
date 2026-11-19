import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { assertManagesProvider } from '../access';
import {
  MANAGES_PROVIDER_KEY,
  type ManagesProviderOptions,
} from '../decorators/manages-provider.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Applies @ManagesProvider(): only the moderator assigned to the airline or
 * hotel in the URL may continue. Must run after JwtAuthGuard.
 */
@Injectable()
export class ProviderOwnerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<
      ManagesProviderOptions | undefined
    >(MANAGES_PROVIDER_KEY, [context.getHandler(), context.getClass()]);
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const providerId = request.params?.[options.param];
    if (typeof providerId !== 'string' || !Types.ObjectId.isValid(providerId)) {
      throw new NotFoundException(`The ${options.type} was not found.`);
    }
    assertManagesProvider(request.user, options.type, providerId);
    return true;
  }
}
