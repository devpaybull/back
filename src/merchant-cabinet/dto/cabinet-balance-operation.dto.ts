import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { MerchantBalanceOperation } from '../../transactions/entities/merchant-balance-operation.entity';
import { MerchantBalanceOperationType } from '../../transactions/types/merchant-balance-operation-type.enum';

export class CabinetBalanceOperationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    enum: MerchantBalanceOperationType,
    description:
      'the «Причина»; «Тип операции» groups are the frontend’s: deal_* — deals, withdrawal_* — withdrawal, admin_adjustment — adjustment',
  })
  type: MerchantBalanceOperationType;

  @ApiProperty({
    type: String,
    example: '-400.000000',
    description: 'signed change of the available balance',
  })
  amount: string;

  @ApiProperty({ type: String })
  balanceBefore: string;

  @ApiProperty({ type: String })
  balanceAfter: string;

  @ApiProperty({ type: String })
  escrowBefore: string;

  @ApiProperty({ type: String })
  escrowAfter: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  transactionId: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'the withdrawal request of a withdrawal_* row',
  })
  withdrawalId: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'the superadmin’s comment on a hand adjustment',
  })
  comment: string | null;
}

export const toCabinetBalanceOperationDto = (
  row: MerchantBalanceOperation,
): CabinetBalanceOperationDto => ({
  id: row.id,
  createdAt: row.createdAt,
  type: row.type,
  amount: formatCrypto(row.amount),
  balanceBefore: formatCrypto(row.balanceBefore),
  balanceAfter: formatCrypto(row.balanceAfter),
  escrowBefore: formatCrypto(row.escrowBefore),
  escrowAfter: formatCrypto(row.escrowAfter),
  transactionId: row.transactionId,
  withdrawalId: row.accountTransactionId,
  comment: row.comment,
});
