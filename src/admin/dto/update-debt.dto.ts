import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  MaxLength,
  MinDate,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateDebtDto {
  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: 'null deletes the comment',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  comment?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'The moment the whole remaining debt is withheld; must be in the future, null removes it',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(() => new Date(), {
    message: '$property must be a moment in the future',
  })
  autoWriteOffAt?: Date | null;

  @ApiPropertyOptional()
  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  autoWriteOffPaused?: boolean;
}
