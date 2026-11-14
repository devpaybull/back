import { ApiProperty } from '@nestjs/swagger';
import { AdminDealAction } from '../../transactions/types/admin-deal-action.enum';
import { CardHistoryEntryDto } from './card-history-entry.dto';
import { CardLeadShareDto } from './card-lead-share.dto';
import { TransactionFileDto } from './transaction-file.dto';
import { TransactionListItemDto } from './transaction-list-item.dto';

export class AdminTransactionCardDto extends TransactionListItemDto {
  @ApiProperty({
    nullable: true,
    description:
      '«Merchant user ID» — payerInfo.userId; «Перейти» opens counterpartyId',
  })
  payerUserId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The first amount, when it was changed',
  })
  originalAmountFiat: string | null;

  @ApiProperty({ type: String, nullable: true })
  originalAmountCrypto: string | null;

  @ApiProperty({ type: [CardLeadShareDto] })
  leadShares: CardLeadShareDto[];

  @ApiProperty({ type: [TransactionFileDto] })
  files: TransactionFileDto[];

  @ApiProperty({ type: [CardHistoryEntryDto], description: 'Newest first' })
  history: CardHistoryEntryDto[];

  @ApiProperty({
    enum: AdminDealAction,
    isArray: true,
    description:
      'What the caller may do with the deal now (the «Быстрые действия»)',
  })
  actions: AdminDealAction[];
}
