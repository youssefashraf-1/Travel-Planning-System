import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BaggagePolicyDto,
  CancellationPolicyDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import { Airline } from './schemas/airline.schema';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
  ) {}

  async create(dto: CreateAirlineDto) {
    try {
      return await this.airlines.create(dto);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async findById(id: string) {
    const airline = Types.ObjectId.isValid(id)
      ? await this.airlines.findById(id).exec()
      : null;
    if (!airline) throw new NotFoundException('Airline not found.');
    return airline;
  }

  update(id: string, dto: UpdateAirlineDto) {
    if (Object.keys(dto).length === 0)
      throw new BadRequestException('Provide name or code.');
    return this.saveChanges(id, Object.assign({}, dto));
  }

  setBaggagePolicy(id: string, dto: BaggagePolicyDto) {
    return this.saveChanges(id, { extraBaggagePolicy: dto });
  }

  setCancellationPolicy(id: string, dto: CancellationPolicyDto) {
    return this.saveChanges(id, { cancellationTiers: dto.cancellationTiers });
  }

  private async saveChanges(id: string, changes: Partial<Airline>) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Airline not found.');
    try {
      const airline = await this.airlines
        .findByIdAndUpdate(
          id,
          { $set: changes },
          { returnDocument: 'after', runValidators: true },
        )
        .exec();
      if (!airline) throw new NotFoundException('Airline not found.');
      return airline;
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      throw new ConflictException('An airline with this code already exists.');
    }
    throw error;
  }
}
