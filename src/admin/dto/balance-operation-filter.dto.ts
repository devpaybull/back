import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';

const toList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' || Array.isArray(value)
    ? [value]
        .flat()
        .flatMap((item: unknown) =>
          typeof item === 'string' ? item.split(',') : [item],
        )
        .map((item: unknown) => (typeof item === 'string' ? item.trim() : item))
        .filter((item) => item !== '')
    : value;

export class BalanceOperationFilterDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Start of the period, inclusive (createdAt >= from)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'End of the period, exclusive (createdAt < to)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    enum: BalanceOperationType,
    isArray: true,
    description: 'One or several types: repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toList)
  @IsEnum(BalanceOperationType, { each: true })
  type?: BalanceOperationType[];

  @ApiPropertyOptional({
    enum: BalanceKind,
    description: 'Which balance: main, insurance pay-in or pay-out',
  })
  @IsOptional()
  @IsEnum(BalanceKind)
  kind?: BalanceKind;
}
