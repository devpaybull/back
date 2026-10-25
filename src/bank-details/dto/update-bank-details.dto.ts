import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { TransactionType } from '../../common/enums/transaction-type.enum';

const MAX_CARDHOLDER_NAME_LENGTH = 100;
const MAX_CARD_LENGTH = 32;
const MAX_PHONE_LENGTH = 32;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateBankDetailsDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankId?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'A device the signed-in account owns',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deviceId?: number;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

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
    description: 'Caps the turnover these details may take in a day',
  })
  @IsOptional()
  @IsBoolean()
  dailyAmountLimitEnabled?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '300000.00',
    description: 'Turnover a day; null unless dailyAmountLimitEnabled is true',
  })
  @IsOptional()
  @IsFiatAmount()
  dailyAmountLimit?: string;

  @ApiPropertyOptional({
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
    description: 'Holds these details back between orders',
  })
  @IsOptional()
  @IsBoolean()
  delayBetweenRequestsEnabled?: boolean;

  @ApiPropertyOptional({
    example: 300,
    description: 'Seconds; null unless delayBetweenRequestsEnabled is true',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  delayBetweenRequests?: number;

  @ApiPropertyOptional({
    description: 'Offers these details to counterparties only',
  })
  @IsOptional()
  @IsBoolean()
  counterpartyOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Marks these details as a reserve requisite',
  })
  @IsOptional()
  @IsBoolean()
  reserve?: boolean;
}
