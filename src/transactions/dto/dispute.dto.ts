import { ApiProperty } from '@nestjs/swagger';
import { formatFiat } from '../../common/utils/format-fiat';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionFile } from '../entities/transaction-file.entity';
import { DisputeStatus } from '../types/dispute-status.enum';
import { DisputeTraderAction } from '../types/dispute-trader-action.enum';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

export class DisputeFileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TransactionFileKind })
  kind: TransactionFileKind;

  @ApiProperty()
  name: string;

  @ApiProperty()
  mime: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  createdAt: Date;
}

export class DisputeDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ format: 'uuid' })
  transactionId: string;

  @ApiProperty({ enum: DisputeStatus })
  status: DisputeStatus;

  @ApiProperty({ enum: TransactionStatus })
  statusBefore: TransactionStatus;

  @ApiProperty({ type: String, nullable: true, description: 'fiat' })
  amount: string | null;

  @ApiProperty()
  openedAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  traderDeadlineAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  traderRespondedAt: Date | null;

  @ApiProperty({ enum: DisputeTraderAction, nullable: true })
  traderAction: DisputeTraderAction | null;

  @ApiProperty({ type: String, nullable: true })
  traderComment: string | null;

  @ApiProperty({ type: String, nullable: true })
  declineReason: string | null;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ type: DisputeFileDto, isArray: true })
  files: DisputeFileDto[];
}

export const toDisputeFileDto = (file: TransactionFile): DisputeFileDto => ({
  id: file.id,
  kind: file.kind,
  name: file.name,
  mime: file.mime,
  size: file.size,
  createdAt: file.createdAt,
});

export const toDisputeDto = (
  dispute: TransactionDispute,
  files: readonly TransactionFile[],
): DisputeDto => ({
  id: dispute.id,
  transactionId: dispute.transactionId,
  status: dispute.status,
  statusBefore: dispute.statusBefore,
  amount: dispute.amountFiat ? formatFiat(dispute.amountFiat) : null,
  openedAt: dispute.openedAt,
  traderDeadlineAt: dispute.traderDeadlineAt ?? null,
  traderRespondedAt: dispute.traderRespondedAt ?? null,
  traderAction: dispute.traderAction ?? null,
  traderComment: dispute.traderComment ?? null,
  declineReason: dispute.declineReason ?? null,
  resolvedAt: dispute.resolvedAt ?? null,
  files: files
    .filter((file) => file.disputeId === dispute.id)
    .map(toDisputeFileDto),
});
