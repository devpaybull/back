import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';

export class AdminBalanceTransferDto {
  @ApiProperty({ enum: BalanceKind })
  @IsEnum(BalanceKind)
  from: BalanceKind;

  @ApiProperty({ enum: BalanceKind })
  @IsEnum(BalanceKind)
  to: BalanceKind;

  @ApiProperty({
    type: String,
    example: '100.000000',
    description: 'USDT, a decimal string with at most 6 decimals',
  })
  @IsCryptoAmount({ positive: true })
  amount: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  comment: string;
}
