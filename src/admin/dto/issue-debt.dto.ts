import { ApiProperty } from '@nestjs/swagger';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

export class IssueDebtDto {
  @ApiProperty({
    type: String,
    example: '500.000000',
    description:
      'USDT credited to the main balance as a debt, a decimal string with at most 6 decimals',
  })
  @IsCryptoAmount({ positive: true })
  amount: string;
}
