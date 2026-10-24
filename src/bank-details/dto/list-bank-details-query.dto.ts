import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { BankDetailsSortField } from '../types/bank-details-sort-field';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListBankDetailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankId?: number;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: BankDetailsSortField,
    default: BankDetailsSortField.CreatedAt,
  })
  @IsEnum(BankDetailsSortField)
  sortBy: BankDetailsSortField = BankDetailsSortField.CreatedAt;
}
