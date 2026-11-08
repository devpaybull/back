import { ApiProperty } from '@nestjs/swagger';

export class TraderActivityEntryDto {
  @ApiProperty()
  id: number;

  @ApiProperty({
    example: 'trader.deal_declined',
    description:
      'trader_activity.login · .logout; activity.trading_enabled · _disabled; activity.bank_details_added · _deleted, bank_details.updated; activity.device_added · _deleted; trader.deal_confirmed · .deal_confirmed_changed · .deal_declined; trader.payout_taken · .payout_completed · .payout_declined; trader.appeal_accepted · .appeal_contested; activity.deposit_credited; activity.withdrawal_completed; balance.transfer',
  })
  action: string;

  @ApiProperty({
    type: Object,
    description:
      'Only what the row says about the trader’s own things: requisites id, type, card, phone, cardholderName, bankName, mobileOperatorName (+ fields on an update); devices id, name, model; deals transactionId (+ amountFiat, originalAmountFiat, reasonCode, comment, traderAmount); money amount, fee, from, to',
  })
  details: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}
