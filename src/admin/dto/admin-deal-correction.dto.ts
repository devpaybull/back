import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminDealCorrectionDto {
  @ApiProperty({
    maxLength: 500,
    description: 'Why; written to the deal’s history and the audit',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Without it, a balance this would take below zero is a 409 OVERDRAFT_NOT_CONFIRMED',
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}
