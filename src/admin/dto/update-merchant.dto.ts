import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { INT4_MAX } from '../../common/utils/int4-max';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateMerchantDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 100,
    description: 'seen by admins only; null or an empty string clears it',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  internalName?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'the group to move the merchant into; null takes it out',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  groupId?: number | null;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'the «Искл. залив» flag' })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  exclusiveTopUp?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'the merchant’s whole currency set (ids of currencies); a currency left out loses its markup',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(INT4_MAX, { each: true })
  currencyIds?: number[];

  @ApiPropertyOptional({
    description: 'must be one of the merchant’s currencies',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  defaultCurrencyId?: number;
}
