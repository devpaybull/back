import { ApiProperty } from '@nestjs/swagger';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';

export class BalanceOperationReferenceDto {
  @ApiProperty({ type: String, nullable: true })
  transactionId: string | null;

  @ApiProperty({ type: Number, nullable: true })
  debtId: number | null;
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

  @ApiProperty({ description: 'Signed: negative for a debit' })
  amount: number;

  @ApiProperty()
  balanceBefore: number;

  @ApiProperty()
  balanceAfter: number;

  @ApiProperty({
    type: BalanceOperationReferenceDto,
    nullable: true,
    description:
      'The reason: a deal (also for lead shares and transfers) or a debt; null when the row carries no link',
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
  amount: operation.amount,
  balanceBefore: operation.balanceBefore,
  balanceAfter: operation.balanceAfter,
  reference:
    operation.transactionId || debtId !== null
      ? { transactionId: operation.transactionId ?? null, debtId }
      : null,
});
