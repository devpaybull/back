import { ApiProperty } from '@nestjs/swagger';
import { TransactionStatus } from '../types/transaction-status.enum';
import { PaymentRequisiteDto } from './payment-requisite.dto';

export class PaymentPageDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '2037.00',
    description: 'The amount the client pays',
  })
  amount: string | null;

  @ApiProperty({ nullable: true, example: 'RUB' })
  currency: string | null;

  @ApiProperty({ type: PaymentRequisiteDto, nullable: true })
  requisite: PaymentRequisiteDto | null;

  @ApiProperty({ nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The deal’s own, else the merchant’s settings',
  })
  successUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The deal’s own, else the merchant’s settings',
  })
  errorUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  supportLink: string | null;
}

export class PaymentPageReceiptDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  mime: string;
}
