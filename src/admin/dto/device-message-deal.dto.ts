import { ApiProperty } from '@nestjs/swagger';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class DeviceMessageDealDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ type: String, example: '1500.00' })
  amountFiat: string;
}
