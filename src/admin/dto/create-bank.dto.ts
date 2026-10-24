import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateBankDto {
  @ApiProperty({ example: 'kaspi', maxLength: MAX_BANK_ID_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_BANK_ID_LENGTH)
  bankId: string;

  @ApiProperty({ example: 'Kaspi Bank', maxLength: MAX_NAME_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiPropertyOptional({ example: 'KASPIKZKA', maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  countryId: number;

  @ApiProperty({
    enum: TransactionType,
    isArray: true,
    example: [TransactionType.Card, TransactionType.Sbp],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(TransactionType, { each: true })
  transactionTypes: TransactionType[];

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currencyId: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  crossBorderCurrencyId?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  automatic?: boolean;
}
