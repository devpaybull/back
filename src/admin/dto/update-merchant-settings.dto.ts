import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { MerchantRateCalculation } from '../../merchants/types/merchant-rate-calculation.enum';
import { MerchantRateSource } from '../../merchants/types/merchant-rate-source.enum';

const URL_OPTIONS = { protocols: ['https'], require_protocol: true };
const URL_MAX = 2048;
const given = (_: object, value: unknown): boolean => value !== undefined;

export class UpdateMerchantSettingsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '50000.00',
    description: 'in the default currency; null removes the minimum',
  })
  @IsOptional()
  @IsFiatAmount({ positive: true })
  minPayInAmount?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 120,
    description: 'null falls back to DEAL_TTL_MINUTES',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  payInWindowMinutes?: number | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 50 })
  @ValidateIf(given)
  @IsInt()
  @Min(0)
  @Max(50)
  randomizationWindow?: number;

  @ApiPropertyOptional()
  @ValidateIf(given)
  @IsBoolean()
  sameRequestsEnabled?: boolean;

  @ApiPropertyOptional()
  @ValidateIf(given)
  @IsBoolean()
  telegramAlertEnabled?: boolean;

  @ApiPropertyOptional()
  @ValidateIf(given)
  @IsBoolean()
  failedDealsLimitEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @ValidateIf(given)
  @IsInt()
  @Min(1)
  @Max(1000)
  failedDealsPerHour?: number;

  @ApiPropertyOptional({ description: 'superadmin only' })
  @ValidateIf(given)
  @IsBoolean()
  payoutOverdraftEnabled?: boolean;

  @ApiPropertyOptional({ description: 'superadmin only' })
  @ValidateIf(given)
  @IsBoolean()
  autoPayoutEnabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'superadmin only; a TRC-20 address',
  })
  @IsOptional()
  @IsString()
  @MaxLength(34)
  autoPayoutAddress?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '10000.000000',
    description: 'superadmin only',
  })
  @IsOptional()
  @IsCryptoAmount({ positive: true })
  autoPayoutAmount?: string | null;

  @ApiPropertyOptional({ type: String, example: '0.000000' })
  @ValidateIf(given)
  @IsCryptoAmount()
  withdrawalFee?: string;

  @ApiPropertyOptional()
  @ValidateIf(given)
  @IsBoolean()
  withdrawalFeeWaived?: boolean;

  @ApiPropertyOptional({ enum: MerchantRateSource })
  @ValidateIf(given)
  @IsEnum(MerchantRateSource)
  rateSource?: MerchantRateSource;

  @ApiPropertyOptional({ enum: MerchantRateCalculation })
  @ValidateIf(given)
  @IsEnum(MerchantRateCalculation)
  rateCalculation?: MerchantRateCalculation;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  callbackUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  successUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  errorUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  supportLink?: string | null;

  @ApiPropertyOptional({
    description:
      'superadmin only; cannot be switched on with an empty whitelist',
  })
  @ValidateIf(given)
  @IsBoolean()
  ipCheckEnabled?: boolean;
}
