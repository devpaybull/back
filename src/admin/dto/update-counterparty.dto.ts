import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const MAX_REASON_LENGTH = 500;

export class UpdateCounterpartyDto {
  @ApiPropertyOptional({
    description: 'A blacklisted counterparty cannot be enabled',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Blacklisting also disables; leaving the blacklist does not enable',
  })
  @IsOptional()
  @IsBoolean()
  blacklisted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoEnableForbidden?: boolean;

  @ApiPropertyOptional({
    maxLength: MAX_REASON_LENGTH,
    description: 'Goes to the audit',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}
