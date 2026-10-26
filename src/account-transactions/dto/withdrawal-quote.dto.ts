import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { WithdrawalQuoteResult } from '../types/withdrawal-quote-result';

export class WithdrawalFeeDto {
  @ApiProperty({ type: String, example: '0.288300' })
  usdt: string;

  @ApiProperty({ type: String, example: '0.845200' })
  trx: string;
}

export class WithdrawalQuoteDto {
  @ApiProperty({ type: String, example: '500.000000' })
  available: string;

  @ApiProperty({ type: WithdrawalFeeDto })
  fee: WithdrawalFeeDto;

  @ApiProperty({ type: String, example: '499.711700' })
  maxAmount: string;

  @ApiProperty({
    description:
      'The address is another trader’s deposit address: an internal transfer, no network, no fee',
  })
  internal: boolean;

  @ApiProperty()
  expiresAt: Date;
}

export const toWithdrawalQuoteDto = (
  quote: WithdrawalQuoteResult,
): WithdrawalQuoteDto => ({
  available: formatCrypto(quote.available),
  fee: { usdt: formatCrypto(quote.fee.usdt), trx: formatCrypto(quote.fee.trx) },
  maxAmount: formatCrypto(quote.maxAmount),
  internal: quote.internal,
  expiresAt: quote.expiresAt,
});
