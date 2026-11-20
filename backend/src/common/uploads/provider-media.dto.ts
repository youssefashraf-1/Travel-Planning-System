import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class RemoveProviderImageDto {
  @ApiProperty({ example: true }) @IsBoolean() @Equals(true) confirm: boolean;
}
