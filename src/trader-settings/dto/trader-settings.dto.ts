import { ApiProperty } from '@nestjs/swagger';
import { Crypto } from '../../common/types/crypto';
import { formatCrypto } from '../../common/utils/format-crypto';
import { TraderSettings } from '../entities/trader-settings.entity';

export class TraderSettingsDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  tradingEnabled: boolean;

  @ApiProperty()
  payoutTradingEnabled: boolean;

  @ApiProperty()
  individualRatesEnabled: boolean;

  @ApiProperty()
  autoBuybackEnabled: boolean;

  @ApiProperty({ nullable: true })
  autoBuybackConcurrent: number;

  @ApiProperty()
  payInAntifraudEnabled: boolean;

  @ApiProperty()
  qrBuybackAccess: boolean;

  @ApiProperty()
  userTransferAccess: boolean;

  @ApiProperty()
  trustedUser: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '500.000000',
    description:
      'Personal minimum insurance pay-in deposit; null means the global default applies',
  })
  insurancePayInMin: string | null;

  @ApiProperty({
    type: String,
    example: '500.000000',
    description: 'The minimum insurance pay-in deposit that actually applies',
  })
  effectiveInsurancePayInMin: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '500.000000',
    description:
      'Personal minimum insurance pay-out deposit; null means the global default applies',
  })
  insurancePayOutMin: string | null;

  @ApiProperty({
    type: String,
    example: '500.000000',
    description: 'The minimum insurance pay-out deposit that actually applies',
  })
  effectiveInsurancePayOutMin: string;

  @ApiProperty({
    description: 'Whether the night stop applies to this trader',
  })
  nightStopEnabled: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Personal night-stop threshold (open disputes), 1-10; null means the global default applies',
  })
  nightStopThreshold: number | null;

  @ApiProperty({
    description: 'The night-stop threshold that actually applies',
  })
  effectiveNightStopThreshold: number;
}

export interface EffectiveTraderSettings {
  insurancePayInMin: Crypto;
  insurancePayOutMin: Crypto;
  nightStopThreshold: number;
}

export const toTraderSettingsDto = (
  row: TraderSettings,
  effective: EffectiveTraderSettings,
): TraderSettingsDto => ({
  userId: row.userId,
  tradingEnabled: row.tradingEnabled,
  payoutTradingEnabled: row.payoutTradingEnabled,
  individualRatesEnabled: row.individualRatesEnabled,
  autoBuybackEnabled: row.autoBuybackEnabled,
  autoBuybackConcurrent: row.autoBuybackConcurrent,
  payInAntifraudEnabled: row.payInAntifraudEnabled,
  qrBuybackAccess: row.qrBuybackAccess,
  userTransferAccess: row.userTransferAccess,
  trustedUser: row.trustedUser,
  insurancePayInMin: formatCrypto(row.insurancePayInMin),
  effectiveInsurancePayInMin: formatCrypto(effective.insurancePayInMin),
  insurancePayOutMin: formatCrypto(row.insurancePayOutMin),
  effectiveInsurancePayOutMin: formatCrypto(effective.insurancePayOutMin),
  nightStopEnabled: row.nightStopEnabled,
  nightStopThreshold: row.nightStopThreshold,
  effectiveNightStopThreshold: effective.nightStopThreshold,
});
