import { ApiProperty } from '@nestjs/swagger';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { WithdrawalAttempt } from '../../account-transactions/entities/withdrawal-attempt.entity';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../../account-transactions/types/account-transaction-status-reason.enum';
import { formatCrypto } from '../../common/utils/format-crypto';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { AccountTransactionPartyDto } from './account-transaction-party.dto';

const REJECTABLE = [
  AccountTransactionStatus.Pending,
  AccountTransactionStatus.Failed,
];

export class WithdrawalAttemptDto {
  @ApiProperty({ type: String, nullable: true })
  txHash: string | null;

  @ApiProperty({ enum: OutgoingTransferStatus })
  status: OutgoingTransferStatus;
}

export class AdminWithdrawalActionsDto {
  @ApiProperty()
  canPayManually: boolean;

  @ApiProperty()
  canReject: boolean;
}

export class AdminWithdrawalDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: AccountTransactionStatus })
  status: AccountTransactionStatus;

  @ApiProperty({ enum: AccountTransactionStatusReason, nullable: true })
  statusReason: AccountTransactionStatusReason | null;

  @ApiProperty({ type: AccountTransactionPartyDto, nullable: true })
  user: AccountTransactionPartyDto | null;

  @ApiProperty()
  address: string;

  @ApiProperty({ type: WithdrawalAttemptDto, isArray: true })
  attempts: WithdrawalAttemptDto[];

  @ApiProperty({ type: String, example: '100.000000' })
  amount: string;

  @ApiProperty({ type: String, example: '0.288300' })
  fee: string;

  @ApiProperty({ type: String, nullable: true })
  txHash: string | null;

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  @ApiProperty()
  paidManually: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  @ApiProperty({ type: AccountTransactionPartyDto, nullable: true })
  actor: AccountTransactionPartyDto | null;

  @ApiProperty({ type: AdminWithdrawalActionsDto })
  actions: AdminWithdrawalActionsDto;
}

export const toAdminWithdrawalDto = (
  row: AccountTransaction,
  attempts: WithdrawalAttempt[],
  parties: Map<string, AccountTransactionPartyDto>,
  payableByHand: AccountTransactionStatus[],
): AdminWithdrawalDto => ({
  id: row.id,
  status: row.status,
  statusReason: row.statusReason,
  user: parties.get(row.userId) ?? null,
  address: row.address!,
  attempts: attempts.map((attempt) => ({
    txHash: attempt.txHash,
    status: attempt.status,
  })),
  amount: formatCrypto(row.amount!),
  fee: formatCrypto(row.fee!),
  txHash: row.txHash,
  comment: row.comment,
  paidManually: row.paidManually ?? false,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
  actor: row.actorUserId ? (parties.get(row.actorUserId) ?? null) : null,
  actions: {
    canPayManually: payableByHand.includes(row.status),
    canReject: REJECTABLE.includes(row.status),
  },
});
