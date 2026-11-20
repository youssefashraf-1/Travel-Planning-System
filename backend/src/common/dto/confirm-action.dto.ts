import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class ConfirmActionDto {
  @ApiProperty({ example: true }) @IsBoolean() @Equals(true) confirm: boolean;
}
