import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';
import { BalanceTransferDirection } from '../types/balance-transfer-direction.enum';

export class TransferBalanceDto {
  @ApiProperty({ enum: BalanceTransferDirection })
  @IsEnum(BalanceTransferDirection)
  direction: BalanceTransferDirection;

  @ApiProperty({
    type: String,
    example: '500.000000',
    description: 'USDT, a decimal string with at most 6 decimals',
  })
  @IsCryptoAmount({ positive: true })
  amount: string;
}
