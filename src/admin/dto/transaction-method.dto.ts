import { ApiProperty } from '@nestjs/swagger';
import { RateKind } from '../../transactions/types/rate-kind.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethodDefinition } from '../../transactions/types/transaction-method-definition';

export class TransactionMethodDto {
  @ApiProperty({ example: 'sbp' })
  code: string;

  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty({
    enum: RateKind,
    description:
      'by_amount: a rate set takes amount bands; by_bank: it takes one row per bank',
  })
  rateKind: RateKind;

  @ApiProperty({
    enum: TransactionKind,
    isArray: true,
    description: 'the deal kinds the method works in',
  })
  directions: TransactionKind[];
}

export const toTransactionMethodDto = (
  method: TransactionMethodDefinition,
): TransactionMethodDto => ({
  code: method.code,
  currency: method.currency,
  rateKind: method.rateKind,
  directions: [...method.directions],
});
