import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../users/schemas/user.schema';
import {
  assertManagesProvider,
  assertOwnedBy,
  managesProvider,
  ProviderType,
} from './access';

describe('access rules', () => {
  const airlineId = new Types.ObjectId();
  const otherAirlineId = new Types.ObjectId();
  const user = (role: UserRole, assignedProviderId?: Types.ObjectId) => ({
    _id: new Types.ObjectId(),
    role,
    assignedProviderId,
  });
  const airlineModerator = user(UserRole.AIRLINE_MODERATOR, airlineId);

  describe('assertManagesProvider', () => {
    it('allows the moderator of that airline, by ObjectId or string', () => {
      expect(() =>
        assertManagesProvider(
          airlineModerator,
          ProviderType.AIRLINE,
          airlineId,
        ),
      ).not.toThrow();
      expect(() =>
        assertManagesProvider(
          airlineModerator,
          ProviderType.AIRLINE,
          airlineId.toString(),
        ),
      ).not.toThrow();
    });

    it('rejects the moderator of another airline', () => {
      expect(() =>
        assertManagesProvider(
          airlineModerator,
          ProviderType.AIRLINE,
          otherAirlineId,
        ),
      ).toThrow(
        new ForbiddenException('You can only manage your own airline.'),
      );
    });

    it.each([
      ['an admin', user(UserRole.ADMIN)],
      ['a traveler', user(UserRole.TRAVELER)],
      // Same id, wrong kind of provider.
      ['a hotel moderator', user(UserRole.HOTEL_MODERATOR, airlineId)],
    ])('rejects %s', (_name, someone) => {
      expect(() =>
        assertManagesProvider(someone, ProviderType.AIRLINE, airlineId),
      ).toThrow(new ForbiddenException('Only airline moderators can do this.'));
    });

    it('checks hotels the same way', () => {
      const hotelId = new Types.ObjectId();
      const hotelModerator = user(UserRole.HOTEL_MODERATOR, hotelId);

      expect(managesProvider(hotelModerator, ProviderType.HOTEL, hotelId)).toBe(
        true,
      );
      expect(
        managesProvider(hotelModerator, ProviderType.AIRLINE, hotelId),
      ).toBe(false);
    });
  });

  describe('assertOwnedBy (ACC-11)', () => {
    const owner = user(UserRole.TRAVELER);

    it('allows the owner', () => {
      expect(() => assertOwnedBy(owner, owner._id.toString())).not.toThrow();
    });

    it('answers 404 to anyone else, even an admin', () => {
      expect(() =>
        assertOwnedBy(user(UserRole.TRAVELER), owner._id, 'Booking not found.'),
      ).toThrow(new NotFoundException('Booking not found.'));
      expect(() => assertOwnedBy(user(UserRole.ADMIN), owner._id)).toThrow(
        NotFoundException,
      );
    });
  });
});
