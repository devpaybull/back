import { ApiProperty } from '@nestjs/swagger';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

export class CreateDepositRequestDto {
  @ApiProperty({
    type: String,
    example: '500.00',
    description:
      'The amount the trader means to send — a hint; whatever arrives is credited',
  })
  @IsCryptoAmount({ positive: true })
  amount: string;
}
