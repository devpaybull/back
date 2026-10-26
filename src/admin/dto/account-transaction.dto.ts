import { ApiProperty } from '@nestjs/swagger';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../../account-transactions/types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { formatCrypto } from '../../common/utils/format-crypto';

export class AccountTransactionDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: AccountTransactionType })
  type: AccountTransactionType;

  @ApiProperty({ enum: AccountTransactionStatus })
  status: AccountTransactionStatus;

  @ApiProperty({ enum: AccountTransactionStatusReason, nullable: true })
  statusReason: AccountTransactionStatusReason | null;

  @ApiProperty({ description: 'The sender of a transfer' })
  userId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The recipient of a transfer; null for other types',
  })
  counterpartyUserId: string | null;

  @ApiProperty({ type: String, example: '50.000000', nullable: true })
  amount: string | null;

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  @ApiProperty({ type: String, nullable: true })
  actorUserId: string | null;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export const toAccountTransactionDto = (
  row: AccountTransaction,
): AccountTransactionDto => ({
  id: row.id,
  type: row.type,
  status: row.status,
  statusReason: row.statusReason,
  userId: row.userId,
  counterpartyUserId: row.counterpartyUserId,
  amount: row.amount === null ? null : formatCrypto(row.amount),
  comment: row.comment,
  actorUserId: row.actorUserId,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
});
