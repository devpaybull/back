import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { BankDetailsSortField } from '../../bank-details/types/bank-details-sort-field';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionType } from '../../common/enums/transaction-type.enum';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListBankDetailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  banned?: boolean;

  @ApiPropertyOptional({
    enum: BankDetailsSortField,
    default: BankDetailsSortField.CreatedAt,
  })
  @IsEnum(BankDetailsSortField)
  sortBy: BankDetailsSortField = BankDetailsSortField.CreatedAt;
}
