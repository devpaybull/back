import { ApiProperty } from '@nestjs/swagger';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { AdminDealCorrectionDto } from './admin-deal-correction.dto';

export class ChangeDealAmountDto extends AdminDealCorrectionDto {
  @ApiProperty({ type: String, example: '1500.00' })
  @IsFiatAmount({ positive: true })
  amountFiat: string;
}
