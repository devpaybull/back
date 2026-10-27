import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateMerchantGroupDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'written into every merchant of the group',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'the «Искл. залив» flag, written into every merchant of the group',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  exclusiveTopUp?: boolean;
}
