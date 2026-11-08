import { ApiProperty } from '@nestjs/swagger';
import { BankDetailsStatus } from '../../bank-details/types/bank-details-status.enum';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';

export class TraderCounterpartyGroupBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}

export class TraderCounterpartyRequisiteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: BankDetailsType })
  type: BankDetailsType;

  @ApiProperty({ type: TraderCounterpartyGroupBankDto, nullable: true })
  bank: TraderCounterpartyGroupBankDto | null;

  @ApiProperty({ type: String, nullable: true })
  cardholderName: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty({ type: String, nullable: true })
  card: string | null;

  @ApiProperty({ enum: BankDetailsStatus })
  status: BankDetailsStatus;
}

export class TraderCounterpartySlotsDto {
  @ApiProperty({ description: 'Counterparties bound now' })
  bound: number;

  @ApiProperty({ type: Number, nullable: true })
  max: number | null;
}

export class TraderCounterpartyGroupDto {
  @ApiProperty({ type: TraderCounterpartyRequisiteDto })
  requisite: TraderCounterpartyRequisiteDto;

  @ApiProperty({
    type: TraderCounterpartySlotsDto,
    description: '«Слотов x / max»',
  })
  slots: TraderCounterpartySlotsDto;

  @ApiProperty({
    type: String,
    example: '500000.50',
    description:
      'Σ amountFiat of the successful deals with this trader of the clients bound here, resolved today and the 29 days before',
  })
  deposits30d: string;
}
