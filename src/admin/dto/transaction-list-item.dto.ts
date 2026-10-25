import { ApiProperty } from '@nestjs/swagger';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionRowDetails } from '../types/transaction-row-details';
import { DealBankDetailsDto } from './deal-bank-details.dto';
import { DealCounterpartyDto } from './deal-counterparty.dto';
import { DealTraderDto } from './deal-trader.dto';
import { toTransactionDto, TransactionDto } from './transaction.dto';
import { UserMerchantDto } from './user-merchant.dto';

export class TransactionListItemDto extends TransactionDto {
  @ApiProperty({ type: DealTraderDto, nullable: true })
  trader: DealTraderDto | null;

  @ApiProperty({
    type: UserMerchantDto,
    nullable: true,
    description:
      'Null for a row with no merchant, such as an internal transfer',
  })
  merchant: UserMerchantDto | null;

  @ApiProperty({
    type: DealBankDetailsDto,
    nullable: true,
    description:
      'The requisite the deal runs on, even if it was deleted since. Null when there is none.',
  })
  bankDetails: DealBankDetailsDto | null;

  @ApiProperty({ type: DealCounterpartyDto, nullable: true })
  counterparty: DealCounterpartyDto | null;
}

export const toTransactionListItemDto = (
  row: Transaction,
  details: TransactionRowDetails,
): TransactionListItemDto => ({ ...toTransactionDto(row), ...details });
