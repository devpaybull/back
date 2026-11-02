import { ApiProperty } from '@nestjs/swagger';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import {
  CounterpartyTraderDto,
  toCounterpartyTraderDto,
} from './counterparty-trader.dto';
import { DealBankDto } from './deal-bank.dto';

export class CounterpartyRequisiteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: TransactionType,
    description: 'The channel the client pays through',
  })
  type: TransactionType;

  @ApiProperty({ nullable: true })
  card: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  cardholderName: string | null;

  @ApiProperty({ type: DealBankDto })
  bank: DealBankDto;

  @ApiProperty({ type: CounterpartyTraderDto, nullable: true })
  trader: CounterpartyTraderDto | null;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  banned: boolean;
}

export const toCounterpartyRequisiteDto = (
  requisite: BankDetails,
): CounterpartyRequisiteDto => ({
  id: requisite.id,
  type: requisite.type,
  card: requisite.card ?? null,
  phone: requisite.phone ?? null,
  cardholderName: requisite.cardholderName ?? null,
  bank: { id: requisite.bank.id, name: requisite.bank.name },
  trader: requisite.user ? toCounterpartyTraderDto(requisite.user) : null,
  active: requisite.active,
  banned: Boolean(requisite.bannedAt),
});
