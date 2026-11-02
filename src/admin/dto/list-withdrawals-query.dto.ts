import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ListAccountTransactionsQueryDto } from './list-account-transactions-query.dto';

export class ListWithdrawalsQueryDto extends ListAccountTransactionsQueryDto {
  @ApiPropertyOptional({
    description: 'only the withdrawal requests of this merchant',
  })
  @IsOptional()
  @IsUUID()
  merchantId?: string;
}
