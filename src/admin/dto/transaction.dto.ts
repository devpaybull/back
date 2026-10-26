import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { formatRate } from '../../common/utils/format-rate';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class TransactionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: TransactionKind })
  kind: TransactionKind;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({
    nullable: true,
    description: 'A method code from the registry in code',
  })
  method: string;

  @ApiProperty()
  traderUserId: string;

  @ApiProperty({ nullable: true })
  bankDetailsId: string;

  @ApiProperty({ nullable: true })
  counterpartyId: number;

  @ApiProperty({ nullable: true })
  merchantId: string;

  @ApiProperty({ type: String, example: '26262.00', nullable: true })
  amountFiat: string;

  @ApiProperty({ type: String, example: '100.000000' })
  amountCrypto: string;

  @ApiProperty({ type: String, example: '88.920000', nullable: true })
  rate: string;

  @ApiProperty({ nullable: true })
  merchantPercent: number;

  @ApiProperty({
    nullable: true,
    description: 'The trader’s own rate, before any platform-minimum shortfall',
  })
  traderPercent: number;

  @ApiProperty({
    nullable: true,
    description:
      'The rate the deal was priced at: traderPercent minus the shortfall the lead shares left under the platform minimum',
  })
  traderEffectivePercent: number;

  @ApiProperty({
    nullable: true,
    description: 'The sum of every lead’s rate on this deal; null with no lead',
  })
  leadPercent: number;

  @ApiProperty({ type: String, example: '100.000000', nullable: true })
  merchantCommission: string;

  @ApiProperty({ type: String, example: '100.000000', nullable: true })
  traderCommission: string;

  @ApiProperty({
    type: String,
    example: '100.000000',
    nullable: true,
    description:
      'The sum of every lead’s share on this deal; null with no lead',
  })
  leadCommission: string;

  @ApiProperty({ type: String, example: '100.000000', nullable: true })
  traderAmount: string;

  @ApiProperty({ type: String, example: '100.000000', nullable: true })
  merchantAmount: string;

  @ApiProperty({ nullable: true })
  comment: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  resolvedAt: Date;

  @ApiProperty({
    nullable: true,
    description:
      'When the deal is canceled by the system if it is still pending or active. Set once at creation and never moved; null for a row that is not a deal.',
  })
  expiresAt: Date | null;
}

export const toTransactionDto = (row: Transaction): TransactionDto => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  method: row.method,
  traderUserId: row.traderUserId,
  bankDetailsId: row.bankDetailsId,
  counterpartyId: row.counterpartyId,
  merchantId: row.merchantId,
  amountFiat: formatFiat(row.amountFiat),
  amountCrypto: formatCrypto(row.amountCrypto),
  rate: formatRate(row.rate),
  merchantPercent: row.merchantPercent,
  traderPercent: row.traderPercent,
  traderEffectivePercent: row.traderEffectivePercent ?? null,
  leadPercent: row.leadPercent,
  merchantCommission: formatCrypto(row.merchantCommission),
  traderCommission: formatCrypto(row.traderCommission),
  leadCommission: formatCrypto(row.leadCommission),
  traderAmount: formatCrypto(row.traderAmount),
  merchantAmount: formatCrypto(row.merchantAmount),
  comment: row.comment,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
  expiresAt: row.expiresAt ?? null,
});
