import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MobileOperatorSortField } from '../../mobile-operators/types/mobile-operator-sort-field';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListMobileOperatorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: MobileOperatorSortField,
    default: MobileOperatorSortField.CreatedAt,
  })
  @IsEnum(MobileOperatorSortField)
  sortBy: MobileOperatorSortField = MobileOperatorSortField.CreatedAt;
}
