import { model, Types } from 'mongoose';
import { User, UserRole, UserSchema, UserStatus } from './user.schema';

const UserModel = model(User.name, UserSchema);
const credentials = {
  name: 'Example Traveler',
  email: 'traveler@example.com',
  passwordHash: 'fixture-only',
};

describe('User schema', () => {
  it('accepts a traveler created before the account fields were introduced', async () => {
    const user = UserModel.hydrate({ ...credentials, role: UserRole.TRAVELER });

    await user.validate();
    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.mustChangePassword).toBe(false);
  });

  it.each([UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR])(
    'requires a single provider ID for %s',
    async (role) => {
      const user = new UserModel({ ...credentials, role });

      await expect(user.validate()).rejects.toMatchObject({
        errors: { assignedProviderId: expect.any(Error) },
      });

      user.assignedProviderId = new Types.ObjectId();
      await expect(user.validate()).resolves.toBeUndefined();
    },
  );

  it('rejects a provider ID on a traveler account', async () => {
    const user = new UserModel({
      ...credentials,
      role: UserRole.TRAVELER,
      assignedProviderId: new Types.ObjectId(),
    });

    await expect(user.validate()).rejects.toMatchObject({
      errors: { assignedProviderId: expect.any(Error) },
    });
  });
});
