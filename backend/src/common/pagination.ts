import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/** GEN-05: every list longer than 10 rows is paginated with page size 10. */
export const PAGE_SIZE = 10;

/** The ?page= query parameter shared by every paginated list. */
export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
}

/** The paging details returned next to every page of results. */
export class PageInfoDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: PAGE_SIZE })
  pageSize: number;

  @ApiProperty({ example: 23 })
  totalItems: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export function pageInfo(page: number, totalItems: number): PageInfoDto {
  return {
    page,
    pageSize: PAGE_SIZE,
    totalItems,
    totalPages: Math.ceil(totalItems / PAGE_SIZE),
  };
}

/** Escapes text so a user's search is matched literally inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
