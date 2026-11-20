import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'MS' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;
}

export class UpdateAirlineDto extends PartialType(CreateAirlineDto, {
  skipNullProperties: false,
}) {}

export class BaggagePolicyDto {
  @ApiProperty({
    example: 2500,
    minimum: 1,
    description:
      'Price per extra bag in minor units. Weight limit is the cabin bag weight limit.',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  pricePerBagMinorUnits: number;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxExtraBagsPerPassenger: number;
}

export class CancellationTierDto {
  @ApiProperty({ example: 7, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  daysBeforeDeparture: number;

  @ApiProperty({ example: 80, minimum: 0, maximum: 100 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  refundPercentage: number;
}

export class CancellationPolicyDto {
  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'Unique thresholds. Highest threshold not exceeding days remaining applies; otherwise refund is zero. An empty list means no refund.',
  })
  @IsArray()
  @ArrayUnique((tier: CancellationTierDto | null) => tier?.daysBeforeDeparture)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];
}

export class AirlineResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() name: string;
  @ApiProperty() code: string;
  @ApiPropertyOptional() logoUrl?: string;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ type: BaggagePolicyDto })
  extraBaggagePolicy?: BaggagePolicyDto;
  @ApiProperty({ type: [CancellationTierDto] })
  cancellationTiers: CancellationTierDto[];
}
