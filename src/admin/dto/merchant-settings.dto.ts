import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { MerchantRateCalculation } from '../../merchants/types/merchant-rate-calculation.enum';
import { MerchantRateSource } from '../../merchants/types/merchant-rate-source.enum';
import { MerchantSettingsView } from '../../merchants/types/merchant-settings-view';

export class MerchantSettingsDto {
  @ApiProperty({ type: Number, nullable: true })
  defaultCurrencyId: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '50000.00',
    description: 'in the default currency; null is no minimum',
  })
  minPayInAmount: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'null takes DEAL_TTL_MINUTES',
  })
  payInWindowMinutes: number | null;

  @ApiProperty({ description: '0–50 whole fiat units added at random' })
  randomizationWindow: number;

  @ApiProperty()
  sameRequestsEnabled: boolean;

  @ApiProperty()
  telegramAlertEnabled: boolean;

  @ApiProperty()
  failedDealsLimitEnabled: boolean;

  @ApiProperty()
  failedDealsPerHour: number;

  @ApiProperty({ description: 'changed by a superadmin only' })
  payoutOverdraftEnabled: boolean;

  @ApiProperty({ description: 'changed by a superadmin only' })
  autoPayoutEnabled: boolean;

  @ApiProperty({ type: String, nullable: true })
  autoPayoutAddress: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10000.000000' })
  autoPayoutAmount: string | null;

  @ApiProperty({ type: String, example: '0.000000' })
  withdrawalFee: string;

  @ApiProperty()
  withdrawalFeeWaived: boolean;

  @ApiProperty({ enum: MerchantRateSource })
  rateSource: MerchantRateSource;

  @ApiProperty({ enum: MerchantRateCalculation })
  rateCalculation: MerchantRateCalculation;

  @ApiProperty({ type: String, nullable: true })
  callbackUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  successUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  errorUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  supportLink: string | null;

  @ApiProperty({ description: 'changed by a superadmin only' })
  ipCheckEnabled: boolean;
}

export const toMerchantSettingsDto = (
  settings: MerchantSettingsView,
): MerchantSettingsDto => ({
  defaultCurrencyId: settings.defaultCurrencyId,
  minPayInAmount:
    settings.minPayInAmount === null
      ? null
      : formatFiat(settings.minPayInAmount),
  payInWindowMinutes: settings.payInWindowMinutes,
  randomizationWindow: settings.randomizationWindow,
  sameRequestsEnabled: settings.sameRequestsEnabled,
  telegramAlertEnabled: settings.telegramAlertEnabled,
  failedDealsLimitEnabled: settings.failedDealsLimitEnabled,
  failedDealsPerHour: settings.failedDealsPerHour,
  payoutOverdraftEnabled: settings.payoutOverdraftEnabled,
  autoPayoutEnabled: settings.autoPayoutEnabled,
  autoPayoutAddress: settings.autoPayoutAddress,
  autoPayoutAmount:
    settings.autoPayoutAmount === null
      ? null
      : formatCrypto(settings.autoPayoutAmount),
  withdrawalFee: formatCrypto(settings.withdrawalFee),
  withdrawalFeeWaived: settings.withdrawalFeeWaived,
  rateSource: settings.rateSource,
  rateCalculation: settings.rateCalculation,
  callbackUrl: settings.callbackUrl,
  successUrl: settings.successUrl,
  errorUrl: settings.errorUrl,
  supportLink: settings.supportLink,
  ipCheckEnabled: settings.ipCheckEnabled,
});
