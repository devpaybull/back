import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const CONTEST_COMMENT_MAX = 1000;

export class ContestAppealDto {
  @ApiPropertyOptional({ type: String, maxLength: CONTEST_COMMENT_MAX })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(CONTEST_COMMENT_MAX)
  comment?: string;
}
