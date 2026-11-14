import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionFilterDto } from './transaction-filter.dto';

export class ListTransactionsQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  TransactionFilterDto,
) {
  @ApiPropertyOptional({
    enum: TransactionSortField,
    default: TransactionSortField.CreatedAt,
  })
  @IsEnum(TransactionSortField)
  sortBy: TransactionSortField = TransactionSortField.CreatedAt;
}
