import { ApiProperty } from '@nestjs/swagger';
import { MerchantCallbackEvent } from '../../merchant-callbacks/types/merchant-callback-event.enum';
import { PaymentDto } from '../../transactions/dto/payment.dto';

export class CallbackPayloadDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'the event; a resend carries the same one, so deduplicate by it',
  })
  eventId: string;

  @ApiProperty({ example: 1, description: '1, 2, 3 … per deal' })
  eventSeq: number;

  @ApiProperty({
    enum: MerchantCallbackEvent,
    enumName: 'MerchantCallbackEvent',
  })
  event: MerchantCallbackEvent;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt: string;

  @ApiProperty({
    type: () => PaymentDto,
    description: 'the deal as GET /v1/payment/{id} showed it at the event',
  })
  payment: PaymentDto;
}
