import { ConflictException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { User, UserRole } from './schemas/user.schema';
import { normalizeEmail, UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const userModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
  };

  const input = {
    name: 'Mona Hassan',
    email: '  Mona.Hassan@Example.COM ',
    passwordHash: 'scrypt$hash',
    termsAndPrivacyAcceptedAt: new Date('2026-11-18T10:00:00Z'),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('normalizes emails like the schema does', () => {
    expect(normalizeEmail('  A.B@Example.COM ')).toBe('a.b@example.com');
  });

  describe('createTraveler', () => {
    it('saves a traveler with a normalized email and consent time', async () => {
      userModel.create.mockResolvedValue({ _id: 'id' });

      await service.createTraveler(input);

      expect(userModel.create).toHaveBeenCalledWith({
        name: 'Mona Hassan',
        email: 'mona.hassan@example.com',
        passwordHash: 'scrypt$hash',
        role: UserRole.TRAVELER,
        termsAndPrivacyAcceptedAt: input.termsAndPrivacyAcceptedAt,
      });
    });

    it('turns a duplicate email index error into 409 Conflict', async () => {
      userModel.create.mockRejectedValue({
        code: 11000,
        keyPattern: { email: 1 },
      });

      await expect(service.createTraveler(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows other database errors', async () => {
      const failure = new Error('connection lost');
      userModel.create.mockRejectedValue(failure);

      await expect(service.createTraveler(input)).rejects.toBe(failure);
    });

    it('does not report other duplicate keys as an email conflict', async () => {
      const failure = { code: 11000, keyPattern: { phone: 1 } };
      userModel.create.mockRejectedValue(failure);

      await expect(service.createTraveler(input)).rejects.toBe(failure);
    });
  });

  describe('findByEmail', () => {
    function mockQuery(result: unknown) {
      const query = {
        select: jest.fn(),
        exec: jest.fn().mockResolvedValue(result),
      };
      userModel.findOne.mockReturnValue(query);
      return query;
    }

    it('looks up the normalized email without the password hash', async () => {
      const query = mockQuery(null);

      await service.findByEmail(' Mona@Example.com');

      expect(userModel.findOne).toHaveBeenCalledWith({
        email: 'mona@example.com',
      });
      expect(query.select).not.toHaveBeenCalled();
    });

    it('includes the password hash only when asked', async () => {
      const query = mockQuery(null);

      await service.findByEmail('mona@example.com', {
        includePasswordHash: true,
      });

      expect(query.select).toHaveBeenCalledWith('+passwordHash');
    });
  });

  describe('findById', () => {
    it('returns null for an id that is not a valid ObjectId', async () => {
      await expect(service.findById('not-an-id')).resolves.toBeNull();
      expect(userModel.findById).not.toHaveBeenCalled();
    });
  });
});
