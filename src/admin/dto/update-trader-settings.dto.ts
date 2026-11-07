import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

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

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'How many pay-outs this trader may hold in work; null is PAYOUT_MAX_ACTIVE_PER_TRADER. Needs a reason',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxActivePayouts?: number | null;

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
    type: String,
    nullable: true,
    example: '500.000000',
    description:
      'Personal minimum insurance pay-in deposit, a decimal string; null resets it to the global default',
  })
  @IsOptional()
  @IsCryptoAmount()
  insurancePayInMin?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '500.000000',
    description:
      'Personal minimum insurance pay-out deposit, a decimal string; null resets it to the global default',
  })
  @IsOptional()
  @IsCryptoAmount()
  insurancePayOutMin?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  nightStopEnabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: 10,
    description:
      'Personal night-stop threshold (open disputes); null resets it to the global default',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  nightStopThreshold?: number | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
