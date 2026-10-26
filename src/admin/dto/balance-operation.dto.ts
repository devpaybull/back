import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';

export class BalanceOperationReferenceDto {
  @ApiProperty({ type: String, nullable: true })
  transactionId: string | null;

  @ApiProperty({ type: Number, nullable: true })
  debtId: number | null;

  @ApiProperty({ type: Number, nullable: true })
  accountTransactionId: number | null;
}

export class BalanceOperationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ enum: BalanceOperationType })
  type: BalanceOperationType;

  @ApiProperty({ enum: BalanceKind })
  kind: BalanceKind;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description: 'Signed: negative for a debit',
  })
  amount: string;

  @ApiProperty({ type: String, example: '100.000000' })
  balanceBefore: string;

  @ApiProperty({ type: String, example: '100.000000' })
  balanceAfter: string;

  @ApiProperty({
    type: BalanceOperationReferenceDto,
    nullable: true,
    description:
      'The reason: a deal (also for lead shares), a debt or an account transaction (a transfer); null when the row carries no link',
  })
  reference: BalanceOperationReferenceDto | null;
}

export const toBalanceOperationDto = (
  operation: BalanceOperation,
  debtId: number | null,
): BalanceOperationDto => ({
  id: operation.id,
  createdAt: operation.createdAt,
  type: operation.type,
  kind: operation.balanceKind,
  amount: formatCrypto(operation.amount),
  balanceBefore: formatCrypto(operation.balanceBefore),
  balanceAfter: formatCrypto(operation.balanceAfter),
  reference:
    operation.transactionId ||
    debtId !== null ||
    operation.accountTransactionId != null
      ? {
          transactionId: operation.transactionId ?? null,
          debtId,
          accountTransactionId: operation.accountTransactionId ?? null,
        }
      : null,
});
