import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { MerchantCallbackStatus } from '../../merchant-callbacks/types/merchant-callback-status.enum';

export class ListMerchantCallbacksQueryDto extends OmitType(
  PaginationQueryDto,
  ['search'] as const,
) {
  @ApiPropertyOptional({ enum: MerchantCallbackStatus, isArray: true })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(MerchantCallbackStatus, { each: true })
  status?: MerchantCallbackStatus[];

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsDateFilter()
  createdFrom?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsDateFilter()
  @IsNotBelow('createdFrom')
  createdTo?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 255,
    description: 'The deal number or merchantTransactionId, whole',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  search?: string;
}
