import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, Max } from 'class-validator';

const MAX_DEBT_AMOUNT = 1e15;

export class IssueDebtDto {
  @ApiProperty({ description: 'USDT credited to the main balance as a debt' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(MAX_DEBT_AMOUNT)
  amount: number;
}
