import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { INT4_MAX } from '../../common/utils/int4-max';
import { BankDetailsStatus } from '../types/bank-details-status.enum';
import { BankDetailsType } from '../types/bank-details-type.enum';
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

  @ApiPropertyOptional({ enum: BankDetailsType })
  @IsOptional()
  @IsEnum(BankDetailsType)
  type?: BankDetailsType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: BankDetailsStatus,
    description:
      'active = switched on and not banned, disabled = switched off and not banned, banned = banned by an administrator',
  })
  @IsOptional()
  @IsEnum(BankDetailsStatus)
  status?: BankDetailsStatus;

  @ApiPropertyOptional({ example: 1, description: 'One of the caller’s tags' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  tagId?: number;

  @ApiPropertyOptional({
    enum: BankDetailsSortField,
    default: BankDetailsSortField.CreatedAt,
  })
  @IsEnum(BankDetailsSortField)
  sortBy: BankDetailsSortField = BankDetailsSortField.CreatedAt;
}
