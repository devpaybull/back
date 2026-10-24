import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateTraderSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tradingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  payoutTradingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  individualRatesEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoBuybackEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  autoBuybackConcurrent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  payInAntifraudEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  qrBuybackAccess?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  userTransferAccess?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  trustedUser?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    description:
      'Personal minimum insurance pay-in deposit; null resets it to the global default',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  insurancePayInMin?: number | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
