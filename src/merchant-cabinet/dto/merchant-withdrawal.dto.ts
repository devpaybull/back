import { ApiProperty } from '@nestjs/swagger';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../../account-transactions/types/account-transaction-status-reason.enum';
import { formatCrypto } from '../../common/utils/format-crypto';

export class MerchantWithdrawalDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'the TRC-20 wallet' })
  address: string;

  @ApiProperty({ type: String, example: '5000.500000' })
  amount: string;

  @ApiProperty({ type: String, description: 'the network fee withheld on top' })
  fee: string;

  @ApiProperty({
    enum: AccountTransactionStatus,
    description:
      'pending — waiting for an admin (the timer is the frontend’s, from createdAt) · completed · canceled · failed',
  })
  status: AccountTransactionStatus;

  @ApiProperty({ enum: AccountTransactionStatusReason, nullable: true })
  statusReason: AccountTransactionStatusReason | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'the paying transaction',
  })
  txHash: string | null;
}

export const toMerchantWithdrawalDto = (
  row: AccountTransaction,
): MerchantWithdrawalDto => ({
  id: row.id,
  address: row.address!,
  amount: formatCrypto(row.amount!),
  fee: formatCrypto(row.fee!),
  status: row.status,
  statusReason: row.statusReason,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
  txHash: row.txHash,
});
