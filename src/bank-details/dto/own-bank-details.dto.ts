import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankDetailsType } from '../types/bank-details-type.enum';
import { Fiat } from '../../common/types/fiat';
import { formatFiat } from '../../common/utils/format-fiat';
import { DeviceStatus } from '../../devices/types/device-status.enum';
import { BankDetails } from '../entities/bank-details.entity';
import { BankDetailsStatus } from '../types/bank-details-status.enum';
import { OwnBankDetailsExtras } from '../types/own-bank-details-extras';

export class OwnBankDetailsTagDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}

export class OwnBankDetailsBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  bankId: string;

  @ApiProperty()
  name: string;
}

export class OwnBankDetailsMobileOperatorDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;
}

export class OwnBankDetailsDeviceDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: DeviceStatus })
  status: DeviceStatus;
}

export class OwnBankDetailsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null on a mobile requisite',
  })
  bankId: number;

  @ApiPropertyOptional({ type: OwnBankDetailsBankDto, nullable: true })
  bank: OwnBankDetailsBankDto;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set on a mobile requisite only',
  })
  mobileOperatorId: number;

  @ApiPropertyOptional({
    type: OwnBankDetailsMobileOperatorDto,
    nullable: true,
  })
  mobileOperator: OwnBankDetailsMobileOperatorDto;

  @ApiPropertyOptional({ nullable: true })
  deviceId: number;

  @ApiPropertyOptional({ type: OwnBankDetailsDeviceDto, nullable: true })
  device: OwnBankDetailsDeviceDto;

  @ApiProperty({ enum: BankDetailsType })
  type: BankDetailsType;

  @ApiPropertyOptional({ nullable: true })
  cardholderName: string;

  @ApiPropertyOptional({ nullable: true })
  card: string;

  @ApiPropertyOptional({ nullable: true })
  phone: string;

  @ApiProperty({
    description: 'Always true while counterpartyOnly is set',
  })
  minAmountEnabled: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '500.00',
    nullable: true,
    description:
      'While counterpartyOnly is set this is the configured floor, not a stored value',
  })
  minAmount: string;

  @ApiProperty()
  maxAmountEnabled: boolean;

  @ApiPropertyOptional({ type: String, example: '100000.00', nullable: true })
  maxAmount: string;

  @ApiProperty()
  dailyLimitEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Orders a day' })
  dailyLimit: number;

  @ApiProperty()
  monthlyLimitEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Orders a month' })
  monthlyLimit: number;

  @ApiProperty({ description: 'Always true: the daily limit is mandatory' })
  dailyAmountLimitEnabled: boolean;

  @ApiProperty({
    type: String,
    example: '300000.00',
    description: 'Turnover a day',
  })
  dailyAmountLimit: string;

  @ApiProperty()
  hourlyAmountLimitEnabled: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '50000.00',
    nullable: true,
    description: 'Turnover of a rolling hour, successful and open deals',
  })
  hourlyAmountLimit: string;

  @ApiProperty()
  monthlyAmountLimitEnabled: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '5000000.00',
    nullable: true,
    description: 'Turnover a month',
  })
  monthlyAmountLimit: string;

  @ApiProperty()
  maxActiveTransactionsEnabled: boolean;

  @ApiPropertyOptional({ nullable: true })
  maxActiveTransactions: number;

  @ApiProperty()
  delayBetweenRequestsEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Seconds' })
  delayBetweenRequests: number;

  @ApiProperty()
  counterpartyOnly: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Counterparty slots; set exactly while counterpartyOnly is',
  })
  maxCounterparties: number;

  @ApiProperty({ description: 'Counterparties bound to this requisite now' })
  boundCounterparties: number;

  @ApiProperty({
    description: 'Takes only deals whose payer bank is this bank',
  })
  sameBankOnly: boolean;

  @ApiProperty()
  reserve: boolean;

  @ApiProperty()
  active: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set by an administrator; the owner cannot lift it',
  })
  bannedAt: Date;

  @ApiProperty({
    enum: BankDetailsStatus,
    description: 'banned while bannedAt is set, otherwise active or disabled',
  })
  status: BankDetailsStatus;

  @ApiProperty({ type: [OwnBankDetailsTagDto] })
  tags: OwnBankDetailsTagDto[];

  @ApiProperty({
    type: String,
    example: '150000.00',
    description: 'Fiat of successful deals, all time («Принято»)',
  })
  turnoverTotal: string;

  @ApiProperty({
    type: String,
    example: '15000.00',
    description: 'Fiat of successful deals resolved today (BUSINESS_TIMEZONE)',
  })
  turnoverToday: string;

  @ApiProperty({
    type: String,
    example: '90000.00',
    description:
      'Fiat of successful deals resolved this month (BUSINESS_TIMEZONE)',
  })
  turnoverMonth: string;

  @ApiProperty({
    description:
      'Deals issued today (BUSINESS_TIMEZONE) and not canceled — what dailyLimit counts',
  })
  dealsToday: number;

  @ApiProperty({
    type: String,
    example: '4000.00',
    description:
      'Fiat of deals issued in the last 60 minutes and not canceled — what hourlyAmountLimit counts',
  })
  lastHourAmount: string;

  @ApiProperty()
  createdAt: Date;
}

export const toOwnBankDetailsDto = (
  details: BankDetails,
  counterpartyMinAmount: Fiat,
  extras: OwnBankDetailsExtras,
): OwnBankDetailsDto => ({
  id: details.id,
  bankId: details.bankId ?? null,
  bank: details.bank
    ? {
        id: details.bank.id,
        bankId: details.bank.bankId,
        name: details.bank.name,
      }
    : null,
  mobileOperatorId: details.mobileOperatorId ?? null,
  mobileOperator: details.mobileOperator
    ? {
        id: details.mobileOperator.id,
        code: details.mobileOperator.code,
        name: details.mobileOperator.name,
      }
    : null,
  deviceId: details.deviceId ?? null,
  device: details.device
    ? {
        id: details.device.id,
        name: details.device.name,
        status: details.device.status,
      }
    : null,
  type: details.type,
  cardholderName: details.cardholderName ?? null,
  card: details.card ?? null,
  phone: details.phone ?? null,
  minAmountEnabled: details.counterpartyOnly
    ? true
    : Boolean(details.minAmountEnabled),
  minAmount: formatFiat(
    details.counterpartyOnly ? counterpartyMinAmount : details.minAmount,
  ),
  maxAmountEnabled: Boolean(details.maxAmountEnabled),
  maxAmount: formatFiat(details.maxAmount),
  dailyLimitEnabled: Boolean(details.dailyLimitEnabled),
  dailyLimit: details.dailyLimit ?? null,
  monthlyLimitEnabled: Boolean(details.monthlyLimitEnabled),
  monthlyLimit: details.monthlyLimit ?? null,
  dailyAmountLimitEnabled: Boolean(details.dailyAmountLimitEnabled),
  dailyAmountLimit: formatFiat(details.dailyAmountLimit),
  monthlyAmountLimitEnabled: Boolean(details.monthlyAmountLimitEnabled),
  monthlyAmountLimit: formatFiat(details.monthlyAmountLimit),
  hourlyAmountLimitEnabled: Boolean(details.hourlyAmountLimitEnabled),
  hourlyAmountLimit: formatFiat(details.hourlyAmountLimit),
  maxActiveTransactionsEnabled: Boolean(details.maxActiveTransactionsEnabled),
  maxActiveTransactions: details.maxActiveTransactions ?? null,
  delayBetweenRequestsEnabled: Boolean(details.delayBetweenRequestsEnabled),
  delayBetweenRequests: details.delayBetweenRequests ?? null,
  counterpartyOnly: Boolean(details.counterpartyOnly),
  maxCounterparties: details.maxCounterparties ?? null,
  boundCounterparties: extras.boundCounterparties,
  sameBankOnly: Boolean(details.sameBankOnly),
  reserve: Boolean(details.reserve),
  active: details.active,
  bannedAt: details.bannedAt ?? null,
  status: details.bannedAt
    ? BankDetailsStatus.Banned
    : details.active
      ? BankDetailsStatus.Active
      : BankDetailsStatus.Disabled,
  tags: extras.tags,
  turnoverTotal: formatFiat(extras.turnover.total),
  turnoverToday: formatFiat(extras.turnover.today),
  turnoverMonth: formatFiat(extras.turnover.month),
  dealsToday: extras.usage.dealsToday,
  lastHourAmount: formatFiat(extras.usage.lastHourAmount),
  createdAt: details.createdAt,
});
