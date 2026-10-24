import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TransactionType } from '../../common/enums/transaction-type.enum';

const MAX_BANK_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 128;
const MAX_CODE_LENGTH = 64;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateBankDto {
  @ApiPropertyOptional({ example: 'kaspi', maxLength: MAX_BANK_ID_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BANK_ID_LENGTH)
  bankId?: string;

  @ApiPropertyOptional({ example: 'Kaspi Bank', maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ example: 'KASPIKZKA', maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId?: number;

  @ApiPropertyOptional({
    enum: TransactionType,
    isArray: true,
    example: [TransactionType.Card],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(TransactionType, { each: true })
  transactionTypes?: TransactionType[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currencyId?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  crossBorderCurrencyId?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  automatic?: boolean;
}
