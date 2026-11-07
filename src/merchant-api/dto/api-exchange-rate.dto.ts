import { ApiProperty } from '@nestjs/swagger';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';

export class ApiExchangeRateDto {
  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty({ enum: TransactionKind })
  type: TransactionKind;

  @ApiProperty({
    type: String,
    example: '92.718000',
    description:
      'fiat per one USDT: the source rate × 1.01 × (1 + the merchant’s markup of this direction)',
  })
  rate: string;
}
