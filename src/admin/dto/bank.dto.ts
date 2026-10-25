import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Bank } from '../../banks/entities/bank.entity';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { CountryDto, toCountryDto } from './country.dto';
import { CurrencyDto, toCurrencyDto } from './currency.dto';

export class BankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  bankId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  code: string;

  @ApiProperty()
  countryId: number;

  @ApiPropertyOptional({ type: CountryDto, nullable: true })
  country: CountryDto;

  @ApiProperty({ enum: TransactionType, isArray: true })
  transactionTypes: TransactionType[];

  @ApiProperty()
  currencyId: number;

  @ApiPropertyOptional({ type: CurrencyDto, nullable: true })
  currency: CurrencyDto;

  @ApiPropertyOptional({ nullable: true })
  crossBorderCurrencyId: number;

  @ApiPropertyOptional({ type: CurrencyDto, nullable: true })
  crossBorderCurrency: CurrencyDto;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  automatic: boolean;

  @ApiProperty()
  createdAt: Date;
}

export const toBankDto = (bank: Bank): BankDto => ({
  id: bank.id,
  bankId: bank.bankId,
  name: bank.name,
  code: bank.code ?? null,
  countryId: bank.countryId,
  country: bank.country ? toCountryDto(bank.country) : null,
  transactionTypes: bank.transactionTypes,
  currencyId: bank.currencyId,
  currency: bank.currency ? toCurrencyDto(bank.currency) : null,
  crossBorderCurrencyId: bank.crossBorderCurrencyId ?? null,
  crossBorderCurrency: bank.crossBorderCurrency
    ? toCurrencyDto(bank.crossBorderCurrency)
    : null,
  active: bank.active,
  automatic: bank.automatic,
  createdAt: bank.createdAt,
});
