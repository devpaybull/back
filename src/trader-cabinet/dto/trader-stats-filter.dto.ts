import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';

export class TraderStatsFilterDto {
  @ApiPropertyOptional({
    enum: TransactionKind,
    description: '«Направление»; both when absent',
  })
  @IsOptional()
  @IsEnum(TransactionKind)
  direction?: TransactionKind;

  @ApiPropertyOptional({ enum: TRANSACTION_METHOD_CODES })
  @IsOptional()
  @IsIn(TRANSACTION_METHOD_CODES)
  method?: TransactionMethod;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'One of the trader’s requisites; another’s matches nothing',
  })
  @IsOptional()
  @IsUUID()
  bankDetailsId?: string;
}
