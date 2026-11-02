import { ApiProperty } from '@nestjs/swagger';
import { MerchantActivityAction } from '../../audit/types/merchant-activity-action.enum';

export class MerchantActivityEntryDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: MerchantActivityAction })
  action: MerchantActivityAction;

  @ApiProperty({
    type: Object,
    nullable: true,
    description:
      'withdrawal events: accountTransactionId, amount, fee, address; links: fields',
  })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;
}
