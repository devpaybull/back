import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { MethodRate } from '../../transactions/entities/method-rate.entity';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';

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

export class RateBankDto {
  @ApiProperty({ description: 'The id of a row in banks' })
  @IsInt()
  @Min(1)
  bankId: number;

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
  @ApiProperty({
    enum: TRANSACTION_METHOD_CODES,
    description: 'A method code from the registry in code',
  })
  @IsIn(TRANSACTION_METHOD_CODES)
  method: TransactionMethod;

  @ApiPropertyOptional({ type: RateGeneralDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => RateGeneralDto)
  general?: RateGeneralDto | null;

  @ApiPropertyOptional({
    type: [RateBandDto],
    default: [],
    description:
      'Amount bands. Only for a method priced by amount (by_amount); a 400 on a method priced by bank. Bands may not overlap; an amount in a gap gets the general rate.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBandDto)
  bands?: RateBandDto[] = [];

  @ApiPropertyOptional({
    type: [RateBankDto],
    default: [],
    description:
      'One rate per bank. Only for a method priced by bank (by_bank); a 400 on a method priced by amount. Every bank must exist and appear once; a deal at a bank without a row gets the general rate.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBankDto)
  banks?: RateBankDto[] = [];
}

export class RateSetDto {
  @ApiProperty({ type: [SubjectMethodRateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubjectMethodRateDto)
  methods: SubjectMethodRateDto[];
}

export const toRateSetDto = (
  rows: Pick<
    MethodRate,
    | 'method'
    | 'bankId'
    | 'fromAmount'
    | 'toAmount'
    | 'payInPercent'
    | 'payOutPercent'
  >[],
): RateSetDto => {
  const byMethod = new Map<TransactionMethod, SubjectMethodRateDto>();

  for (const row of rows) {
    let entry = byMethod.get(row.method);
    if (!entry) {
      entry = { method: row.method, general: null, bands: [], banks: [] };
      byMethod.set(row.method, entry);
    }

    if (row.bankId !== null && row.bankId !== undefined) {
      entry.banks.push({
        bankId: row.bankId,
        payInPercent: row.payInPercent,
        payOutPercent: row.payOutPercent,
      });
    } else if (row.fromAmount === null && row.toAmount === null) {
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
