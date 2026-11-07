import { ApiProperty } from '@nestjs/swagger';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import {
  CounterpartyTraderDto,
  toCounterpartyTraderDto,
} from './counterparty-trader.dto';
import { DealBankDto } from './deal-bank.dto';

export class CounterpartyRequisiteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: BankDetailsType,
    description: 'card_or_sbp or mobile',
  })
  type: BankDetailsType;

  @ApiProperty({ nullable: true })
  card: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  cardholderName: string | null;

  @ApiProperty({ type: DealBankDto, nullable: true })
  bank: DealBankDto | null;

  @ApiProperty({
    type: DealBankDto,
    nullable: true,
    description: '{ id, name } of the operator of a mobile requisite',
  })
  mobileOperator: DealBankDto | null;

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
  bank: requisite.bank
    ? { id: requisite.bank.id, name: requisite.bank.name }
    : null,
  mobileOperator: requisite.mobileOperator
    ? { id: requisite.mobileOperator.id, name: requisite.mobileOperator.name }
    : null,
  trader: requisite.user ? toCounterpartyTraderDto(requisite.user) : null,
  active: requisite.active,
  banned: Boolean(requisite.bannedAt),
});
