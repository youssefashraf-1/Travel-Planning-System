import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, Max, Min } from 'class-validator';
import { CabinClass } from '../schemas/cabin-inventory.schema';

export class CreateCabinDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;

  @ApiProperty({ example: 100, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  totalSeats: number;

  @ApiProperty({
    example: 15000,
    minimum: 1,
    description: 'Fare in minor units; whole numbers only.',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  priceMinorUnits: number;

  @ApiProperty({ example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  freeBagCount: number;

  @ApiProperty({ example: 23, minimum: 0, exclusiveMinimum: true })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(Number.MIN_VALUE)
  maxBagWeightKg: number;
}
