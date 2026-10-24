import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { TransactionMethod } from '../../transactions/types/transaction-method.enum';

export class RateGeneralDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payInPercent: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payOutPercent: number;
}

export class RateBandDto {
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  fromAmount: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  toAmount: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payInPercent: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payOutPercent: number;
}

export class SubjectMethodRateDto {
  @ApiProperty({ enum: TransactionMethod })
  @IsEnum(TransactionMethod)
  method: TransactionMethod;

  @ApiPropertyOptional({ type: RateGeneralDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateGeneralDto)
  general?: RateGeneralDto | null;

  @ApiProperty({ type: [RateBandDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBandDto)
  bands: RateBandDto[];
}

export class RateSetDto {
  @ApiProperty({ type: [SubjectMethodRateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubjectMethodRateDto)
  methods: SubjectMethodRateDto[];
}

export const toRateSetDto = (rows: MethodRate[]): RateSetDto => {
  const byMethod = new Map<TransactionMethod, SubjectMethodRateDto>();

  for (const row of rows) {
    let entry = byMethod.get(row.method);
    if (!entry) {
      entry = { method: row.method, general: null, bands: [] };
      byMethod.set(row.method, entry);
    }

    if (row.fromAmount === null && row.toAmount === null) {
      entry.general = {
        payInPercent: row.payInPercent,
        payOutPercent: row.payOutPercent,
      };
    } else {
      entry.bands.push({
        fromAmount: row.fromAmount,
        toAmount: row.toAmount,
        payInPercent: row.payInPercent,
        payOutPercent: row.payOutPercent,
      });
    }
  }

  return { methods: [...byMethod.values()] };
};
