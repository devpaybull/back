import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { PayerInfoDto } from './payer-info.dto';

const URL_OPTIONS = { protocols: ['https'], require_protocol: true };
const URL_MAX = 2048;
const CODE_MAX = 64;
const MERCHANT_TRANSACTION_ID = /^[A-Za-z0-9._:-]{1,255}$/;

export class CreatePayInDto {
  @ApiProperty({
    example: 'sbp',
    description:
      'A method code from the registry; one that does not work for pay-in is 400 METHOD_NOT_SUPPORTED',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CODE_MAX)
  method: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'number' }],
    example: '2000.00',
    description:
      'Fiat, > 0, at most 2 decimals, at most 1e12; a JSON string or number, checked by its decimal text',
  })
  @IsFiatAmount({ positive: true })
  amount: string;

  @ApiPropertyOptional({
    example: 'RUB',
    description: 'If given, must be the method’s currency',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CODE_MAX)
  currency?: string;

  @ApiProperty({ pattern: MERCHANT_TRANSACTION_ID.source })
  @IsString()
  @Matches(MERCHANT_TRANSACTION_ID)
  merchantTransactionId: string;

  @ApiProperty({ type: PayerInfoDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PayerInfoDto)
  payerInfo: PayerInfoDto;

  @ApiPropertyOptional({
    description: 'An active bank’s code; absent means any bank',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CODE_MAX)
  bank?: string;

  @ApiPropertyOptional({
    description: 'The bank the client pays from, a bank code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CODE_MAX)
  payerBank?: string;

  @ApiPropertyOptional({
    description: 'A mobile operator code, for mobile_commerce',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CODE_MAX)
  operator?: string;

  @ApiPropertyOptional({ maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  callbackUrl?: string;

  @ApiPropertyOptional({ maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  successUrl?: string;

  @ApiPropertyOptional({ maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  errorUrl?: string;
}
