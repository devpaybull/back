import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { TransactionMethod } from '../../transactions/types/transaction-method.enum';

export class BaseMethodRateDto {
  @ApiProperty({ enum: TransactionMethod })
  @IsEnum(TransactionMethod)
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
  @ApiProperty({ type: [BaseMethodRateDto] })
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
