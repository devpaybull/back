import { ApiProperty } from '@nestjs/swagger';
import { DealBankDto } from './deal-bank.dto';

export class DealPayoutRecipientDto {
  @ApiProperty({ nullable: true, description: 'null is «Без ФИО»' })
  ownerName: string | null;

  @ApiProperty({ type: DealBankDto, nullable: true })
  bank: DealBankDto | null;

  @ApiProperty({ nullable: true })
  cardNumber: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;
}
