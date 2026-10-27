import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, Max, Min } from 'class-validator';
import { INT4_MAX } from '../../common/utils/int4-max';

const MARKUP_LIMIT = 99.999;

export class MerchantMarkupDto {
  @ApiProperty({ description: 'one of the merchant’s currencies' })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  currencyId: number;

  @ApiProperty({
    description: 'percent added to the rate of pay-in deals in this currency',
    minimum: -MARKUP_LIMIT,
    maximum: MARKUP_LIMIT,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-MARKUP_LIMIT)
  @Max(MARKUP_LIMIT)
  payInPercent: number;

  @ApiProperty({
    description: 'percent added to the rate of pay-out deals in this currency',
    minimum: -MARKUP_LIMIT,
    maximum: MARKUP_LIMIT,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-MARKUP_LIMIT)
  @Max(MARKUP_LIMIT)
  payOutPercent: number;
}
