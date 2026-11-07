import { ApiProperty } from '@nestjs/swagger';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';

export class ConfirmChangedDealDto {
  @ApiProperty({
    type: String,
    example: '1500.00',
    description: 'The fiat actually received, > 0, at most 2 decimals',
  })
  @IsFiatAmount({ positive: true })
  amount: string;
}
