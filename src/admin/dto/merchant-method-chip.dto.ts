import { ApiProperty } from '@nestjs/swagger';

export class MerchantMethodChipDto {
  @ApiProperty({ example: 'sbp' })
  method: string;

  @ApiProperty({ description: 'green when true, red when false' })
  enabled: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'the merchant’s effective general percent for the method and direction; null on a group row or when no rate is set',
  })
  percent: number | null;

  @ApiProperty({
    example: '150000.00',
    description:
      'fiat sum of the successful deals (success, success_changed) resolved within the period, for the method and direction; on a group row, the sum over its merchants',
  })
  volume: string;
}
