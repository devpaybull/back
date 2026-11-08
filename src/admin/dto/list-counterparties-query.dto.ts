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
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CounterpartySortField } from '../../counterparties/types/counterparty-sort-field.enum';
import { CounterpartyStatus } from '../../counterparties/types/counterparty-status.enum';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListCounterpartiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Counterparties bound to a requisite of this trader',
  })
  @IsOptional()
  @IsUUID()
  traderUserId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Counterparties bound to this requisite',
  })
  @IsOptional()
  @IsUUID()
  bankDetailsId?: string;

  @ApiPropertyOptional({ enum: CounterpartyStatus })
  @IsOptional()
  @IsEnum(CounterpartyStatus)
  status?: CounterpartyStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  blacklisted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  autoEnableForbidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  hasRequisite?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 7 days, at least, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  volume7dFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 7 days, at most, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('volume7dFrom')
  volume7dTo?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 30 days, at least, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  volume30dFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 30 days, at most, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('volume30dFrom')
  volume30dTo?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 60 days, at least, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  volume60dFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 60 days, at most, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('volume60dFrom')
  volume60dTo?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 90 days, at least, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  volume90dFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over the last 90 days, at most, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('volume90dFrom')
  volume90dTo?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over all time, at least, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  volumeTotalFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'Paid volume over all time, at most, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('volumeTotalFrom')
  volumeTotalTo?: string;

  @ApiPropertyOptional({
    description: 'Paid deals over the last 30 days, at least',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  paid30dFrom?: number;

  @ApiPropertyOptional({
    description: 'Paid deals over the last 30 days, at most',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsNotBelow('paid30dFrom')
  paid30dTo?: number;

  @ApiPropertyOptional({
    description:
      'Deal-creation requests over the last 30 days (today and the 29 days before, BUSINESS_TIMEZONE), at least',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  requests30dFrom?: number;

  @ApiPropertyOptional({
    description: 'Deal-creation requests over the last 30 days, at most',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsNotBelow('requests30dFrom')
  requests30dTo?: number;

  @ApiPropertyOptional({
    enum: CounterpartySortField,
    default: CounterpartySortField.CreatedAt,
  })
  @IsEnum(CounterpartySortField)
  sortBy: CounterpartySortField = CounterpartySortField.CreatedAt;
}
