import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { INT4_MAX } from '../../common/utils/int4-max';
import { DELAY_BETWEEN_REQUESTS_SECONDS } from '../utils/delay-between-requests-seconds';
import { BankDetailsType } from '../types/bank-details-type.enum';

const MAX_CARDHOLDER_NAME_LENGTH = 100;
const MAX_CARD_LENGTH = 32;
const MAX_PHONE_LENGTH = 32;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBankDetailsDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'Required for a card_or_sbp requisite, refused on a mobile one',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankId?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Required for a mobile requisite, refused on any other',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mobileOperatorId?: number;

  @ApiProperty({
    example: 1,
    description: 'A device the signed-in account owns; required',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  deviceId: number;

  @ApiProperty({ enum: BankDetailsType, example: BankDetailsType.CardOrSbp })
  @IsEnum(BankDetailsType)
  type: BankDetailsType;

  @ApiPropertyOptional({
    example: 'IVAN IVANOV',
    maxLength: MAX_CARDHOLDER_NAME_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(MAX_CARDHOLDER_NAME_LENGTH)
  cardholderName?: string;

  @ApiPropertyOptional({
    example: '4400430212345678',
    maxLength: MAX_CARD_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(MAX_CARD_LENGTH)
  @Matches(/^\d+$/, { message: 'card must contain digits only' })
  card?: string;

  @ApiPropertyOptional({ example: '+79991234567', maxLength: MAX_PHONE_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(MAX_PHONE_LENGTH)
  @Matches(/^\+?\d+$/, {
    message: 'phone must contain digits, optionally led by +',
  })
  phone?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Caps the smallest amount an order may ask for',
  })
  @IsOptional()
  @IsBoolean()
  minAmountEnabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '500.00',
    description: 'Ignored and stored as null unless minAmountEnabled is true',
  })
  @IsOptional()
  @IsFiatAmount()
  minAmount?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Caps the largest amount an order may ask for',
  })
  @IsOptional()
  @IsBoolean()
  maxAmountEnabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '100000.00',
    description: 'Ignored and stored as null unless maxAmountEnabled is true',
  })
  @IsOptional()
  @IsFiatAmount()
  maxAmount?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Caps how many orders a day these details may take',
  })
  @IsOptional()
  @IsBoolean()
  dailyLimitEnabled?: boolean;

  @ApiPropertyOptional({
    example: 40,
    description: 'Orders a day; null unless dailyLimitEnabled is true',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyLimit?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Caps how many orders a month these details may take',
  })
  @IsOptional()
  @IsBoolean()
  monthlyLimitEnabled?: boolean;

  @ApiPropertyOptional({
    example: 800,
    description: 'Orders a month; null unless monthlyLimitEnabled is true',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyLimit?: number;

  @ApiPropertyOptional({
    enum: [true],
    default: true,
    description:
      'The daily turnover limit is mandatory and cannot be switched off; false is a 400',
  })
  @IsOptional()
  @IsIn([true], { message: 'dailyAmountLimitEnabled cannot be switched off' })
  dailyAmountLimitEnabled?: boolean;

  @ApiProperty({
    type: String,
    example: '300000.00',
    description: 'Turnover a day (fiat); required',
  })
  @IsFiatAmount()
  dailyAmountLimit: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Caps the turnover of the last 60 minutes, successful and open deals together',
  })
  @IsOptional()
  @IsBoolean()
  hourlyAmountLimitEnabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '50000.00',
    description:
      'Turnover a rolling hour; null unless hourlyAmountLimitEnabled is true',
  })
  @IsOptional()
  @IsFiatAmount()
  hourlyAmountLimit?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Caps the turnover these details may take in a month',
  })
  @IsOptional()
  @IsBoolean()
  monthlyAmountLimitEnabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '5000000.00',
    description:
      'Turnover a month; null unless monthlyAmountLimitEnabled is true',
  })
  @IsOptional()
  @IsFiatAmount()
  monthlyAmountLimit?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Caps how many deals may be open at once',
  })
  @IsOptional()
  @IsBoolean()
  maxActiveTransactionsEnabled?: boolean;

  @ApiPropertyOptional({
    example: 3,
    description: 'Open deals; null unless maxActiveTransactionsEnabled is true',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxActiveTransactions?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Holds these details back between orders',
  })
  @IsOptional()
  @IsBoolean()
  delayBetweenRequestsEnabled?: boolean;

  @ApiPropertyOptional({
    enum: DELAY_BETWEEN_REQUESTS_SECONDS,
    example: 300,
    description:
      'Seconds, one of 5, 30, 60, 300, 900, 1800, 3600, 10800; null unless delayBetweenRequestsEnabled is true',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(DELAY_BETWEEN_REQUESTS_SECONDS)
  delayBetweenRequests?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Offers these details to counterparties only',
  })
  @IsOptional()
  @IsBoolean()
  counterpartyOnly?: boolean;

  @ApiPropertyOptional({
    example: 8,
    minimum: 1,
    description:
      'Counterparty slots: required while counterpartyOnly is set, refused (400) otherwise',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  maxCounterparties?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Takes only deals whose payer bank is the bank of this requisite',
  })
  @IsOptional()
  @IsBoolean()
  sameBankOnly?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Tags of the signed-in account; another account’s tag is a 404',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(INT4_MAX, { each: true })
  tagIds?: number[];

  @ApiPropertyOptional({
    default: false,
    description: 'Marks these details as a reserve requisite',
  })
  @IsOptional()
  @IsBoolean()
  reserve?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
