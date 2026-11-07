import { ApiProperty } from '@nestjs/swagger';

export class PaymentBankDto {
  @ApiProperty({ nullable: true, example: 'tbank' })
  code: string | null;

  @ApiProperty({ example: 'T-Bank' })
  name: string;
}
