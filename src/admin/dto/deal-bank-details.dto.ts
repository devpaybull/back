import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { DealBankDto } from './deal-bank.dto';

export class DealBankDetailsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ nullable: true })
  card: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  cardholderName: string | null;

  @ApiProperty({ type: DealBankDto })
  bank: DealBankDto;
}
