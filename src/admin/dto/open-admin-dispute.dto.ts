import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';

export class OpenAdminDisputeDto {
  @ApiPropertyOptional({
    type: String,
    example: '5000.00',
    description:
      '«Сумма платежа»; a settled pay-in needs one above its amount, a pay-out ignores it',
  })
  @IsOptional()
  @IsFiatAmount({ positive: true })
  amountFiat?: string;
}
