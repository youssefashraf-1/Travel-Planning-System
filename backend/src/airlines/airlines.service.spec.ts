import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { AirlinesService } from './airlines.service';
import { Airline } from './schemas/airline.schema';

describe('AirlinesService', () => {
  it('translates unique-index conflicts rather than relying on a race-prone pre-check', async () => {
    const service = new AirlinesService({
      create: () => Promise.reject({ code: 11000 }),
    } as unknown as Model<Airline>);
    await expect(
      service.create({ name: 'Airline', code: 'MS' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects an empty update and malformed id', async () => {
    const service = new AirlinesService({} as Model<Airline>);
    expect(() => service.update(new Types.ObjectId().toString(), {})).toThrow(
      BadRequestException,
    );
    await expect(service.findById('invalid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
