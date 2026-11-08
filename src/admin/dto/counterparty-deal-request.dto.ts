import { ApiProperty } from '@nestjs/swagger';
import { MerchantRequestResult } from '../../merchant-requests/types/merchant-request-result.enum';

export class CounterpartyDealRequestDto {
  @ApiProperty({
    format: 'uuid',
    description: 'the request log row, as GET /admin/merchant-requests/:id',
  })
  id: string;

  @ApiProperty({ nullable: true, example: 'sbp' })
  method: string | null;

  @ApiProperty({ type: String, nullable: true, example: '2000.00' })
  amountFiat: string | null;

  @ApiProperty({ nullable: true, example: 'RUB' })
  currency: string | null;

  @ApiProperty({ enum: MerchantRequestResult })
  result: MerchantRequestResult;

  @ApiProperty()
  statusCode: number;

  @ApiProperty({ nullable: true })
  errorCode: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'the deal the request created or answered with',
  })
  dealId: string | null;
}
