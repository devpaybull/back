import { ApiProperty } from '@nestjs/swagger';
import { formatCrypto } from '../../common/utils/format-crypto';
import { MerchantBalanceOperation } from '../../transactions/entities/merchant-balance-operation.entity';
import { MerchantBalanceOperationType } from '../../transactions/types/merchant-balance-operation-type.enum';

export class MerchantBalanceOperationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ enum: MerchantBalanceOperationType })
  type: MerchantBalanceOperationType;

  @ApiProperty({
    type: String,
    example: '-400.000000',
    description:
      'signed change of the available balance (balanceAfter − balanceBefore); zero for a pay-out settled out of escrow',
  })
  amount: string;

  @ApiProperty({
    type: String,
    description: 'the available balance before the operation',
  })
  balanceBefore: string;

  @ApiProperty({
    type: String,
    description: 'the available balance after the operation',
  })
  balanceAfter: string;

  @ApiProperty({
    type: String,
    description: 'the escrow held for pay-outs before the operation',
  })
  escrowBefore: string;

  @ApiProperty({
    type: String,
    description: 'the escrow held for pay-outs after the operation',
  })
  escrowAfter: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  transactionId: string | null;

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorUserId: string | null;
}

export const toMerchantBalanceOperationDto = (
  row: MerchantBalanceOperation,
): MerchantBalanceOperationDto => ({
  id: row.id,
  createdAt: row.createdAt,
  type: row.type,
  amount: formatCrypto(row.amount),
  balanceBefore: formatCrypto(row.balanceBefore),
  balanceAfter: formatCrypto(row.balanceAfter),
  escrowBefore: formatCrypto(row.escrowBefore),
  escrowAfter: formatCrypto(row.escrowAfter),
  transactionId: row.transactionId,
  comment: row.comment,
  actorUserId: row.actorUserId,
});
