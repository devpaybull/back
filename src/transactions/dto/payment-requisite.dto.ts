import { ApiProperty } from '@nestjs/swagger';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { PaymentBankDto } from './payment-bank.dto';

export class PaymentRequisiteDto {
  @ApiProperty({ type: PaymentBankDto, nullable: true })
  bank: PaymentBankDto | null;

  @ApiProperty({ enum: BankDetailsType })
  type: BankDetailsType;

  @ApiProperty({ nullable: true, example: '2200700012345678' })
  cardNumber: string | null;

  @ApiProperty({ nullable: true, example: '79001234567' })
  sbpNumber: string | null;

  @ApiProperty({ nullable: true, example: 'IVAN IVANOV' })
  ownerName: string | null;
}
