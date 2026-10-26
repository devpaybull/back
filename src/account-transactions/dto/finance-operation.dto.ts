import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

export class FinanceOperationDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: AccountTransactionType })
  type: AccountTransactionType;

  @ApiProperty({
    type: String,
    enum: ['in', 'out'],
    description: 'in: money reached this account; out: it left',
  })
  direction: 'in' | 'out';

  @ApiProperty({ enum: AccountTransactionStatus })
  status: AccountTransactionStatus;

  @ApiProperty({ enum: AccountTransactionStatusReason, nullable: true })
  statusReason: AccountTransactionStatusReason | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The deposit address or the withdrawal destination; null for a transfer',
  })
  address: string | null;

  @ApiProperty({
    type: String,
    example: '500.000000',
    nullable: true,
    description:
      'Credited for a deposit (requested until then), sent for a withdrawal',
  })
  amount: string | null;

  @ApiProperty({ type: String, example: '0.288300', nullable: true })
  fee: string | null;

  @ApiProperty({ type: String, nullable: true })
  txHash: string | null;

  @ApiProperty({ type: Date, nullable: true })
  expiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;
}

export const toFinanceOperationDto = (
  row: AccountTransaction,
  viewerUserId: string,
): FinanceOperationDto => {
  const amount = row.creditedAmount ?? row.amount;

  return {
    id: row.id,
    type: row.type,
    direction:
      row.type === AccountTransactionType.Deposit ||
      (row.type === AccountTransactionType.Transfer &&
        row.counterpartyUserId === viewerUserId)
        ? 'in'
        : 'out',
    status: row.status,
    statusReason: row.statusReason,
    address: row.address,
    amount: amount === null ? null : formatCrypto(amount),
    fee: row.fee === null ? null : formatCrypto(row.fee),
    txHash: row.txHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
};
