import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';

const FILE_KEYS_MAX = 5;

export class OpenDisputeDto {
  @ApiProperty({
    type: String,
    isArray: true,
    minItems: 1,
    maxItems: FILE_KEYS_MAX,
    description: 'What POST /v1/files returned for this deal',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FILE_KEYS_MAX)
  @IsUUID(undefined, { each: true })
  fileKeys: string[];

  @ApiPropertyOptional({
    oneOf: [{ type: 'string' }, { type: 'number' }],
    example: '2000.00',
    description:
      'What the client really paid. On a settled deal it is required and must exceed the deal’s amount; a pay-out has none',
  })
  @IsOptional()
  @IsFiatAmount({ positive: true })
  amount?: string;
}
