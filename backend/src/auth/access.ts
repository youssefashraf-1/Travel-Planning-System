import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { User, UserRole } from '../users/schemas/user.schema';

/** The two kinds of provider; matches :type in /api/admin/providers/:type/:id. */
export enum ProviderType {
  AIRLINE = 'airline',
  HOTEL = 'hotel',
}

const moderatorRoleFor: Record<ProviderType, UserRole> = {
  [ProviderType.AIRLINE]: UserRole.AIRLINE_MODERATOR,
  [ProviderType.HOTEL]: UserRole.HOTEL_MODERATOR,
};

type Id = Types.ObjectId | string;
type AccessUser = Pick<User, 'role' | 'assignedProviderId'> & {
  _id: Types.ObjectId;
};

/** True when the user is the moderator of exactly this airline or hotel. */
export function managesProvider(
  user: AccessUser,
  type: ProviderType,
  providerId: Id,
): boolean {
  return (
    user.role === moderatorRoleFor[type] &&
    user.assignedProviderId != null &&
    user.assignedProviderId.toString() === providerId.toString()
  );
}

/**
 * Moderators manage only their own airline or hotel (ACC-13, FLT-03 to
 * FLT-09, FLT-29, HTL-03 to HTL-10, HTL-22). Use it in a service after
 * loading a record that belongs to a provider, for example:
 *
 *   const flight = await this.flightModel.findById(id);
 *   assertManagesProvider(user, ProviderType.AIRLINE, flight.airlineId);
 *
 * For routes whose :id is the provider itself, use @ManagesProvider()
 * with ProviderOwnerGuard instead.
 */
export function assertManagesProvider(
  user: AccessUser,
  type: ProviderType,
  providerId: Id,
): void {
  if (user.role !== moderatorRoleFor[type]) {
    throw new ForbiddenException(`Only ${type} moderators can do this.`);
  }
  if (!managesProvider(user, type, providerId)) {
    throw new ForbiddenException(`You can only manage your own ${type}.`);
  }
}

/**
 * ACC-11: bookings and private itineraries are visible only to their
 * owner. Anyone else gets 404, so the record's existence is not revealed.
 * Admin and moderator read access (ACC-17, FLT-29, HTL-22) is granted by
 * their own routes, not here.
 */
export function assertOwnedBy(
  user: Pick<AccessUser, '_id'>,
  ownerId: Id,
  notFoundMessage = 'Not found.',
): void {
  if (user._id.toString() !== ownerId.toString()) {
    throw new NotFoundException(notFoundMessage);
  }
}
