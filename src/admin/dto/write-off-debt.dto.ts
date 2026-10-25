import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsPositive, Max, ValidateIf } from 'class-validator';

const MAX_DEBT_AMOUNT = 1e15;

export class WriteOffDebtDto {
  @ApiPropertyOptional({
    description:
      'USDT withheld from the main balance; absent withholds the whole remaining debt',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(MAX_DEBT_AMOUNT)
  amount?: number;
}
