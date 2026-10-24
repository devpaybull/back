import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { BankSortField } from '../../banks/types/bank-sort-field';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionType } from '../../common/enums/transaction-type.enum';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListBanksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currencyId?: number;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  transactionType?: TransactionType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  automatic?: boolean;

  @ApiPropertyOptional({
    enum: BankSortField,
    default: BankSortField.CreatedAt,
  })
  @IsEnum(BankSortField)
  sortBy: BankSortField = BankSortField.CreatedAt;
}
