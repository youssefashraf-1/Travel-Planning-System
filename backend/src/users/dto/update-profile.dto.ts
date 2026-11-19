import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Trims text; an empty string means "remove this value" (null). */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * ACC-09: edit name, phone number and preferred currency. Send only the
 * fields to change. Phone and currency accept null (or "") to remove them.
 * Nothing is saved unless every field is valid.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Mona Hassan', maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '+20 100 123 4567',
    nullable: true,
    description:
      '7 to 15 digits; may start with + and contain spaces, ' +
      'brackets or dashes. null removes it.',
  })
  @Transform(trimOrNull)
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(/^\+?(?:[\s()-]*\d){7,15}[\s()-]*$/, {
    message: 'phone must be a valid phone number with 7 to 15 digits',
  })
  @MaxLength(25)
  phone?: string | null;

  @ApiPropertyOptional({
    example: 'EGP',
    nullable: true,
    description:
      'A supported currency code from the reference data. null removes it.',
  })
  @Transform(({ value }: { value: unknown }) => {
    const trimmed = trimOrNull({ value });
    return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed;
  })
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'preferredCurrency must be a three-letter currency code',
  })
  preferredCurrency?: string | null;
}
