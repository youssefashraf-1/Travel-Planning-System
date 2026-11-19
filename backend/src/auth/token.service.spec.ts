import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { UserRole } from '../users/schemas/user.schema';
import { TokenService } from './token.service';

const SECRET = 'a'.repeat(48);

function serviceWithSecret(secret: string | undefined) {
  const config = { get: jest.fn().mockReturnValue(secret) };
  return new TokenService(
    new JwtService({}),
    config as unknown as ConfigService,
  );
}

describe('TokenService', () => {
  const user = { _id: new Types.ObjectId(), role: UserRole.TRAVELER };

  it('signs a token that verifies back to the user id and role', async () => {
    const service = serviceWithSecret(SECRET);

    const token = await service.signAccessToken(user);
    const payload = await service.verifyAccessToken(token);

    expect(payload.sub).toBe(user._id.toString());
    expect(payload.role).toBe(UserRole.TRAVELER);
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await serviceWithSecret('b'.repeat(48)).signAccessToken(user);

    await expect(
      serviceWithSecret(SECRET).verifyAccessToken(token),
    ).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const service = serviceWithSecret(SECRET);
    const [header, , signature] = (await service.signAccessToken(user)).split(
      '.',
    );
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: user._id.toString(), role: UserRole.ADMIN }),
    ).toString('base64url');

    await expect(
      service.verifyAccessToken(`${header}.${forgedBody}.${signature}`),
    ).rejects.toThrow();
  });

  it.each([undefined, 'too-short'])(
    'refuses to sign when the secret is %p',
    async (secret) => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const service = serviceWithSecret(secret);
      (service as any).logger.error = jest.fn();

      expect(() => service.signAccessToken(user)).toThrow(
        InternalServerErrorException,
      );
    },
  );
});
