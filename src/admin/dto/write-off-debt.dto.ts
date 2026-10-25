import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

export class WriteOffDebtDto {
  @ApiPropertyOptional({
    type: String,
    example: '250.000000',
    description:
      'USDT withheld from the main balance, a decimal string; absent withholds the whole remaining debt',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsCryptoAmount({ positive: true })
  amount?: string;
}
