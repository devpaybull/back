import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';

const ADJUSTMENT_DIRECTIONS = ['credit', 'debit'] as const;

export class AdjustMerchantBalanceDto {
  @ApiProperty({ enum: ADJUSTMENT_DIRECTIONS })
  @IsIn(ADJUSTMENT_DIRECTIONS)
  direction: 'credit' | 'debit';

  @ApiProperty({ type: String, example: '100.000000' })
  @IsCryptoAmount({ positive: true })
  amount: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  comment: string;
}
