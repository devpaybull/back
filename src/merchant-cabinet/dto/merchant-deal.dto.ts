import { ApiProperty } from '@nestjs/swagger';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class MerchantDealRequisiteDto {
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

export class MerchantDealCounterpartyDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;
}

export class MerchantDealDto {
  @ApiProperty({ format: 'uuid', description: 'the deal number' })
  id: string;

  @ApiProperty({ enum: TransactionKind })
  kind: TransactionKind;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ type: String, nullable: true })
  method: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'the deadline; «Время до отмены» is computed from it while pending/active',
  })
  expiresAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({
    type: String,
    example: '450.50',
    description: 'fiat, «К получению / списанию»',
  })
  amountFiat: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'RUB',
    description: 'the method’s currency',
  })
  currency: string | null;

  @ApiProperty({
    type: String,
    example: '88.520000',
    description: 'fiat per one USDT',
  })
  rate: string;

  @ApiProperty({ type: String, example: '5.089245' })
  amountCrypto: string;

  @ApiProperty({
    type: String,
    description: 'USDT to the merchant after its commission',
  })
  merchantAmount: string;

  @ApiProperty({ type: String })
  merchantCommission: string;

  @ApiProperty({ type: MerchantDealRequisiteDto, nullable: true })
  requisite: MerchantDealRequisiteDto | null;

  @ApiProperty({ type: MerchantDealCounterpartyDto, nullable: true })
  counterparty: MerchantDealCounterpartyDto | null;
}

export class MerchantDealStatusEventDto {
  @ApiProperty({ enum: TransactionStatus, nullable: true })
  fromStatus: TransactionStatus | null;

  @ApiProperty({ enum: TransactionStatus })
  toStatus: TransactionStatus;

  @ApiProperty()
  createdAt: Date;
}

export class MerchantDealDetailDto extends MerchantDealDto {
  @ApiProperty({ type: MerchantDealStatusEventDto, isArray: true })
  statusHistory: MerchantDealStatusEventDto[];
}
