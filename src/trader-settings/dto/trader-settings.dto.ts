import { ApiProperty } from '@nestjs/swagger';
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
    nullable: true,
    description:
      'Personal minimum insurance pay-in deposit; null means the global default applies',
  })
  insurancePayInMin: number | null;

  @ApiProperty({
    description: 'The minimum insurance pay-in deposit that actually applies',
  })
  effectiveInsurancePayInMin: number;
}

export const toTraderSettingsDto = (
  row: TraderSettings,
  effectiveInsurancePayInMin: number,
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
  insurancePayInMin: row.insurancePayInMin,
  effectiveInsurancePayInMin,
});
