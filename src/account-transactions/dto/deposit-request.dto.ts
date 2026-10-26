import { ApiProperty } from '@nestjs/swagger';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { formatCrypto } from '../../common/utils/format-crypto';

export class DepositRequestDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: String, example: '500.000000', nullable: true })
  amount: string | null;

  @ApiProperty({ type: String, example: '500.000000', nullable: true })
  creditedAmount: string | null;

  @ApiProperty({ example: 'TRC20' })
  network: string;

  @ApiProperty()
  address: string;

  @ApiProperty({ description: 'PNG data URI of the bare address' })
  qrCode: string;

  @ApiProperty({ type: Date, nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ enum: AccountTransactionStatus })
  status: AccountTransactionStatus;

  @ApiProperty({ enum: AccountTransactionStatusReason, nullable: true })
  statusReason: AccountTransactionStatusReason | null;

  @ApiProperty()
  createdAt: Date;
}

export const toDepositRequestDto = (
  row: AccountTransaction,
  qrCode: string,
): DepositRequestDto => ({
  id: row.id,
  amount: row.amount === null ? null : formatCrypto(row.amount),
  creditedAmount:
    row.creditedAmount === null ? null : formatCrypto(row.creditedAmount),
  network: 'TRC20',
  address: row.address!,
  qrCode,
  expiresAt: row.expiresAt,
  status: row.status,
  statusReason: row.statusReason,
  createdAt: row.createdAt,
});
