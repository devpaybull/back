import { ApiProperty } from '@nestjs/swagger';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class PayoutRecipientDto {
  @ApiProperty({ type: Object, nullable: true, description: '{ id, name }' })
  bank: { id: number; name: string } | null;

  @ApiProperty({ type: String, nullable: true })
  ownerName: string | null;

  @ApiProperty({ type: String, nullable: true })
  cardNumber: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;
}

export class TraderPayoutDto {
  @ApiProperty({ format: 'uuid', description: 'the deal number' })
  id: string;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ type: String, nullable: true })
  method: string | null;

  @ApiProperty({ type: String, nullable: true })
  currency: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  takenAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: '«Время на оплату»' })
  paymentDeadlineAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: '«Выполнено»' })
  completedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ type: String, description: '«Сумма к отправке», fiat' })
  amountFiat: string;

  @ApiProperty({ type: String })
  rate: string;

  @ApiProperty({ type: PayoutRecipientDto })
  recipient: PayoutRecipientDto;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: '{ id, name }; the merchant’s own name is never shown',
  })
  merchantGroup: { id: number; name: string } | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '«Сумма к начислению», USDT. In the pool it is priced for this trader on the fly; null means no rate, so taking it is a 409',
  })
  traderAmount: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'USDT' })
  profit: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'profit in fiat at the deal’s rate',
  })
  profitFiat: string | null;
}

export class PayoutReceiptDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  mime: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  createdAt: Date;
}

export class TraderPayoutDetailDto extends TraderPayoutDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: '«Ставка», percent',
  })
  traderEffectivePercent: number | null;

  @ApiProperty({ type: PayoutReceiptDto, isArray: true })
  receipts: PayoutReceiptDto[];
}
