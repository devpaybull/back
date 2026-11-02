import { ApiProperty } from '@nestjs/swagger';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class CounterpartyDealDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TransactionKind })
  kind: TransactionKind;

  @ApiProperty()
  method: string;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ type: String, example: '200000.00' })
  amountFiat: string;
}
