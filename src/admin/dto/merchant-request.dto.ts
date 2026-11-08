import { ApiProperty } from '@nestjs/swagger';
import { MerchantRequestOperation } from '../../merchant-requests/types/merchant-request-operation.enum';
import { MerchantRequestResult } from '../../merchant-requests/types/merchant-request-result.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';

export class MerchantRequestMerchantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true })
  name: string | null;
}

export class MerchantRequestBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;
}

export class MerchantRequestProcessorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;
}

export class MerchantRequestDto {
  @ApiProperty({
    format: 'uuid',
    description: 'the row id, the X-Request-Id the merchant got',
  })
  id: string;

  @ApiProperty({ description: 'when the request arrived' })
  receivedAt: Date;

  @ApiProperty({ type: MerchantRequestMerchantDto })
  merchant: MerchantRequestMerchantDto;

  @ApiProperty({
    enum: MerchantRequestOperation,
    nullable: true,
    description: 'null for a request that creates nothing (reads, cancel, …)',
  })
  operation: MerchantRequestOperation | null;

  @ApiProperty({ enum: TransactionKind, nullable: true })
  direction: TransactionKind | null;

  @ApiProperty({ nullable: true, description: 'the payment method asked for' })
  method: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2000.00',
    description: 'the amount asked for, fiat',
  })
  amount: string | null;

  @ApiProperty({ nullable: true, example: 'RUB' })
  currency: string | null;

  @ApiProperty({
    type: MerchantRequestBankDto,
    nullable: true,
    description: 'the bank asked for; null — «Любой банк»',
  })
  bank: MerchantRequestBankDto | null;

  @ApiProperty({
    nullable: true,
    description: 'payerInfo.userId — the client’s id at the merchant',
  })
  payerUserId: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'the counterparty (merchant, payerUserId) names — null when there is no payer or no such counterparty',
  })
  counterpartyId: number | null;

  @ApiProperty({ nullable: true })
  merchantTransactionId: string | null;

  @ApiProperty({
    enum: MerchantRequestResult,
    description:
      'created / not_created for a deal creation; ok / error for anything else',
  })
  result: MerchantRequestResult;

  @ApiProperty()
  statusCode: number;

  @ApiProperty({
    nullable: true,
    example: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
  })
  errorCode: string | null;

  @ApiProperty({
    type: MerchantRequestProcessorDto,
    nullable: true,
    description: '«Обработано»: the trader (or cascade) of the deal',
  })
  processedBy: MerchantRequestProcessorDto | null;

  @ApiProperty({
    description: '«Ответ за» / «Время обработки»: arrival to the answer, ms',
  })
  durationMs: number;

  @ApiProperty({ format: 'uuid', nullable: true })
  transactionId: string | null;
}
