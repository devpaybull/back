import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { PayerInfoDto } from './payer-info.dto';
import { PayOutRequisiteDto } from './pay-out-requisite.dto';

const URL_OPTIONS = { protocols: ['https'], require_protocol: true };
const URL_MAX = 2048;
const CODE_MAX = 64;
const MERCHANT_TRANSACTION_ID = /^[A-Za-z0-9._:-]{1,255}$/;
const TIMEOUT_MIN_MINUTES = 1;
const TIMEOUT_MAX_MINUTES = 120;

const RECIPIENT_FIELD_OF_METHOD: Record<string, keyof PayOutRequisiteDto> = {
  card: 'cardNumber',
  sbp: 'sbpNumber',
};

const MatchesMethod = () =>
  ValidateBy({
    name: 'matchesMethod',
    validator: {
      validate: (value: unknown, args) => {
        const method = (args?.object as CreatePayOutDto).method;
        const required = RECIPIENT_FIELD_OF_METHOD[method];

        if (!required || typeof value !== 'object' || value === null) {
          return true;
        }

        const requisite = value as PayOutRequisiteDto;

        return Object.values(RECIPIENT_FIELD_OF_METHOD).every((field) =>
          field === required
            ? requisite[field] !== undefined
            : requisite[field] === undefined,
        );
      },
      defaultMessage: () =>
        'requisite needs cardNumber for card and sbpNumber for sbp, and only that one',
    },
  });

export class CreatePayOutDto {
  @ApiProperty({
    enum: ['sbp', 'card'],
    description:
      'A method working in pay-out; any other is 400 METHOD_NOT_SUPPORTED',
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

  @ApiProperty({
    type: PayOutRequisiteDto,
    description: 'The recipient: card → cardNumber, sbp → sbpNumber',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PayOutRequisiteDto)
  @MatchesMethod()
  requisite: PayOutRequisiteDto;

  @ApiPropertyOptional({ maxLength: URL_MAX })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(URL_MAX)
  callbackUrl?: string;

  @ApiPropertyOptional({
    minimum: TIMEOUT_MIN_MINUTES,
    maximum: TIMEOUT_MAX_MINUTES,
    description: 'Minutes; absent means the merchant’s payment window',
  })
  @IsOptional()
  @IsInt()
  @Min(TIMEOUT_MIN_MINUTES)
  @Max(TIMEOUT_MAX_MINUTES)
  timeoutInMin?: number;

  @ApiPropertyOptional({ type: PayerInfoDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PayerInfoDto)
  payerInfo?: PayerInfoDto;
}
