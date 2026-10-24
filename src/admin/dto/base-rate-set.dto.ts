import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, Min, ValidateNested } from 'class-validator';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';

export class BaseMethodRateDto {
  @ApiProperty({
    enum: TRANSACTION_METHOD_CODES,
    description: 'A method code from the registry in code',
  })
  @IsIn(TRANSACTION_METHOD_CODES)
  method: TransactionMethod;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payInPercent: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payOutPercent: number;
}

export class BaseRateSetDto {
  @ApiProperty({
    type: [BaseMethodRateDto],
    description:
      'General rates only: a base rate has no amount bands and no bank rows',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BaseMethodRateDto)
  methods: BaseMethodRateDto[];
}

export const toBaseRateSetDto = (rows: MethodRate[]): BaseRateSetDto => ({
  methods: rows.map((row) => ({
    method: row.method,
    payInPercent: row.payInPercent,
    payOutPercent: row.payOutPercent,
  })),
});
