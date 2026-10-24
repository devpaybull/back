import { ApiProperty } from '@nestjs/swagger';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class TransactionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: TransactionKind })
  kind: TransactionKind;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ enum: TransactionMethod, nullable: true })
  method: TransactionMethod;

  @ApiProperty()
  traderUserId: string;

  @ApiProperty({ nullable: true })
  bankDetailsId: string;

  @ApiProperty({ nullable: true })
  counterpartyId: number;

  @ApiProperty({ nullable: true })
  recipientUserId: string;

  @ApiProperty({ nullable: true })
  merchantId: string;

  @ApiProperty({ nullable: true })
  amountFiat: number;

  @ApiProperty()
  amountCrypto: number;

  @ApiProperty({ nullable: true })
  rate: number;

  @ApiProperty({ nullable: true })
  merchantPercent: number;

  @ApiProperty({ nullable: true })
  traderPercent: number;

  @ApiProperty({ nullable: true })
  leadPercent: number;

  @ApiProperty({ nullable: true })
  merchantCommission: number;

  @ApiProperty({ nullable: true })
  traderCommission: number;

  @ApiProperty({ nullable: true })
  leadCommission: number;

  @ApiProperty({ nullable: true })
  traderAmount: number;

  @ApiProperty({ nullable: true })
  merchantAmount: number;

  @ApiProperty({ nullable: true })
  comment: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  resolvedAt: Date;
}

export const toTransactionDto = (row: Transaction): TransactionDto => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  method: row.method,
  traderUserId: row.traderUserId,
  bankDetailsId: row.bankDetailsId,
  counterpartyId: row.counterpartyId,
  recipientUserId: row.recipientUserId,
  merchantId: row.merchantId,
  amountFiat: row.amountFiat,
  amountCrypto: row.amountCrypto,
  rate: row.rate,
  merchantPercent: row.merchantPercent,
  traderPercent: row.traderPercent,
  leadPercent: row.leadPercent,
  merchantCommission: row.merchantCommission,
  traderCommission: row.traderCommission,
  leadCommission: row.leadCommission,
  traderAmount: row.traderAmount,
  merchantAmount: row.merchantAmount,
  comment: row.comment,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
});
