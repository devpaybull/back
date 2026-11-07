import { ApiProperty } from '@nestjs/swagger';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { DealBankDto } from './deal-bank.dto';

export class DealBankDetailsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: BankDetailsType })
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
}
