import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method.enum';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransactionKind })
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ enum: TransactionMethod })
  @IsOptional()
  @IsEnum(TransactionMethod)
  method?: TransactionMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  traderUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({
    enum: TransactionSortField,
    default: TransactionSortField.CreatedAt,
  })
  @IsEnum(TransactionSortField)
  sortBy: TransactionSortField = TransactionSortField.CreatedAt;
}
