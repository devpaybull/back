import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

export class WithdrawalQuoteQueryDto {
  @ApiProperty({ example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' })
  @IsString()
  @MaxLength(64)
  address: string;

  @ApiProperty({ type: String, example: '100.00' })
  @IsCryptoAmount({ positive: true })
  amount: string;
}
