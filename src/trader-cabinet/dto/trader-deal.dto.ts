import { ApiProperty } from '@nestjs/swagger';
import { PayInDeclineReason } from '../../transactions/types/pay-in-decline-reason.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class TraderDealRequisiteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: '{ id, name } of the bank; null on a mobile requisite',
  })
  bank: { id: number; name: string } | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: '{ id, name } of the operator of a mobile requisite',
  })
  mobileOperator: { id: number; name: string } | null;

  @ApiProperty()
  type: string;

  @ApiProperty({ type: String, nullable: true })
  cardholderName: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty({ type: String, nullable: true })
  card: string | null;
}

export class TraderDealDto {
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

  @ApiProperty({ type: Date, nullable: true, description: 'the timer ends' })
  expiresAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ type: String, example: '1000.50' })
  amountFiat: string;

  @ApiProperty({ type: String, example: '95.000000' })
  rate: string;

  @ApiProperty({ type: TraderDealRequisiteDto, nullable: true })
  requisite: TraderDealRequisiteDto | null;

  @ApiProperty({ type: Number, nullable: true })
  counterpartyId: number | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: '{ id, name }; the merchant’s own name is never shown',
  })
  merchantGroup: { id: number; name: string } | null;

  @ApiProperty({ type: String, example: '4.742000', description: 'USDT' })
  profit: string;

  @ApiProperty({
    type: String,
    example: '450.50',
    description: 'profit in fiat at the deal’s rate',
  })
  profitFiat: string;
}

export class TraderDealDetailDto extends TraderDealDto {
  @ApiProperty({ type: String, description: '«Списание», USDT' })
  traderAmount: string;

  @ApiProperty({ type: Number, description: '«Ставка», percent' })
  traderEffectivePercent: number;

  @ApiProperty({ type: Object, isArray: true, description: '{ id, name }' })
  tags: { id: number; name: string }[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'What the deal was for before «Завершить с пересчетом»',
  })
  originalAmountFiat: string | null;

  @ApiProperty({ enum: PayInDeclineReason, nullable: true })
  declineReasonCode: PayInDeclineReason | null;

  @ApiProperty({ type: String, nullable: true })
  declineComment: string | null;
}
