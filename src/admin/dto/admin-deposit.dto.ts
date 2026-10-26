import { ApiProperty } from '@nestjs/swagger';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { DepositTransfer } from '../../account-transactions/entities/deposit-transfer.entity';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../../account-transactions/types/account-transaction-status-reason.enum';
import { formatCrypto } from '../../common/utils/format-crypto';
import { AccountTransactionPartyDto } from './account-transaction-party.dto';

export class DepositTransferDto {
  @ApiProperty()
  txHash: string;

  @ApiProperty({ type: String, example: '90000.000000' })
  amount: string;

  @ApiProperty()
  fromAddress: string;
}

export class AdminDepositActionsDto {
  @ApiProperty()
  canCredit: boolean;
}

export class AdminDepositDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: AccountTransactionStatus })
  status: AccountTransactionStatus;

  @ApiProperty({ enum: AccountTransactionStatusReason, nullable: true })
  statusReason: AccountTransactionStatusReason | null;

  @ApiProperty({ type: AccountTransactionPartyDto, nullable: true })
  user: AccountTransactionPartyDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The amount the trader asked for — a hint; null without a request',
  })
  amount: string | null;

  @ApiProperty({ type: String, nullable: true })
  amountReceived: string | null;

  @ApiProperty({ type: String, nullable: true })
  creditedAmount: string | null;

  @ApiProperty({ type: String, nullable: true })
  address: string | null;

  @ApiProperty({ description: 'The request window in minutes' })
  windowMinutes: number;

  @ApiProperty({ type: Date, nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ type: DepositTransferDto, isArray: true })
  transfers: DepositTransferDto[];

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Always null until AML screening exists (T04)',
  })
  aml: null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  @ApiProperty({ type: AccountTransactionPartyDto, nullable: true })
  actor: AccountTransactionPartyDto | null;

  @ApiProperty({ type: AdminDepositActionsDto })
  actions: AdminDepositActionsDto;
}

export const toAdminDepositDto = (
  row: AccountTransaction,
  transfers: DepositTransfer[],
  parties: Map<string, AccountTransactionPartyDto>,
  windowMinutes: number,
): AdminDepositDto => ({
  id: row.id,
  status: row.status,
  statusReason: row.statusReason,
  user: parties.get(row.userId) ?? null,
  amount: row.amount === null ? null : formatCrypto(row.amount),
  amountReceived:
    row.amountReceived === null ? null : formatCrypto(row.amountReceived),
  creditedAmount:
    row.creditedAmount === null ? null : formatCrypto(row.creditedAmount),
  address: row.address,
  windowMinutes,
  expiresAt: row.expiresAt,
  transfers: transfers.map((transfer) => ({
    txHash: transfer.txHash,
    amount: formatCrypto(transfer.amount),
    fromAddress: transfer.fromAddress,
  })),
  aml: null,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
  actor: row.actorUserId ? (parties.get(row.actorUserId) ?? null) : null,
  actions: { canCredit: row.status === AccountTransactionStatus.Failed },
});
