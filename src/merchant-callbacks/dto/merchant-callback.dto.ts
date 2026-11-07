import { ApiProperty } from '@nestjs/swagger';
import { MerchantCallback } from '../entities/merchant-callback.entity';
import { MerchantCallbackEvent } from '../types/merchant-callback-event.enum';
import { MerchantCallbackStatus } from '../types/merchant-callback-status.enum';

export class MerchantCallbackDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  eventId: string;

  @ApiProperty()
  eventSeq: number;

  @ApiProperty({ enum: MerchantCallbackEvent })
  event: MerchantCallbackEvent;

  @ApiProperty({ enum: MerchantCallbackStatus })
  status: MerchantCallbackStatus;

  @ApiProperty({ format: 'uuid' })
  dealId: string;

  @ApiProperty({ type: String, nullable: true })
  merchantTransactionId: string | null;

  @ApiProperty({ type: String, nullable: true })
  dealStatus: string | null;

  @ApiProperty({ type: String, nullable: true })
  amount: string | null;

  @ApiProperty({ type: String, nullable: true })
  currency: string | null;

  @ApiProperty()
  attempts: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  lastAttemptAt: Date | null;

  @ApiProperty({ type: Number, nullable: true })
  lastResponseCode: number | null;

  @ApiProperty({ type: String, nullable: true })
  lastError: string | null;

  @ApiProperty({ type: Object, description: 'What was or will be sent' })
  payload: Record<string, unknown>;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The first 2 KB of the answer, as text',
  })
  response: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The callback this one sends again',
  })
  resendOfId: string | null;
}

const REFUSED_FOR_MERCHANT = 'The callback address was refused';
const CONNECTION_FOR_MERCHANT = 'The connection failed';
const SHOWN_AS_IS =
  /^(Answered \d+|The merchant has no active API key|The last attempts)/;

const merchantVisibleError = (error: string | null): string | null => {
  if (!error || SHOWN_AS_IS.test(error)) return error;

  return /refused|not public|must be https|cannot be read/i.test(error) &&
    error.startsWith('The callback')
    ? REFUSED_FOR_MERCHANT
    : CONNECTION_FOR_MERCHANT;
};

export const toMerchantCallbackDtoForMerchant = (
  row: MerchantCallback,
): MerchantCallbackDto => ({
  ...toMerchantCallbackDto(row),
  lastError: merchantVisibleError(row.lastError ?? null),
});

export const toMerchantCallbackDto = (
  row: MerchantCallback,
): MerchantCallbackDto => {
  const payment = (row.payload.payment ?? {}) as Record<string, string | null>;

  return {
    id: row.id,
    eventId: row.eventId,
    eventSeq: row.eventSeq,
    event: row.event,
    status: row.status,
    dealId: row.transactionId,
    merchantTransactionId: row.merchantTransactionId ?? null,
    dealStatus: payment.status ?? null,
    amount: payment.amount ?? null,
    currency: payment.currency ?? null,
    attempts: row.attempts,
    createdAt: row.createdAt,
    lastAttemptAt: row.lastAttemptAt ?? null,
    lastResponseCode: row.lastResponseCode ?? null,
    lastError: row.lastError ?? null,
    payload: row.payload,
    response: row.lastResponseBody ?? null,
    resendOfId: row.resendOfId ?? null,
  };
};
