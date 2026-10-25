import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { Fiat } from '../../common/types/fiat';
import { formatFiat } from '../../common/utils/format-fiat';
import { loginOf } from '../../common/utils/login-of';
import { BankDetailsTurnover } from '../../transactions/types/bank-details-turnover';
import { DeviceStatus } from '../../devices/types/device-status.enum';
import { InviteAccountDto, toInviteAccountDto } from './invite-account.dto';

export class BankDetailsBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  bankId: string;

  @ApiProperty()
  name: string;
}

export class BankDetailsDeviceDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: DeviceStatus })
  status: DeviceStatus;

  @ApiPropertyOptional({ nullable: true })
  lastActivity: Date;
}

export class BankDetailsTraderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  login: string;
}

export class BankDetailsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  user: InviteAccountDto;

  @ApiProperty()
  bankId: number;

  @ApiPropertyOptional({ type: BankDetailsBankDto, nullable: true })
  bank: BankDetailsBankDto;

  @ApiPropertyOptional({ nullable: true })
  deviceId: number;

  @ApiPropertyOptional({ type: BankDetailsDeviceDto, nullable: true })
  device: BankDetailsDeviceDto;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

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

  @ApiProperty()
  dailyAmountLimitEnabled: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '300000.00',
    nullable: true,
    description: 'Turnover a day',
  })
  dailyAmountLimit: string;

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

  @ApiProperty()
  reserve: boolean;

  @ApiProperty()
  active: boolean;

  @ApiPropertyOptional({ nullable: true })
  bannedAt: Date;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  bannedBy: InviteAccountDto;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ type: BankDetailsTraderDto, nullable: true })
  trader: BankDetailsTraderDto;

  @ApiProperty({
    type: String,
    example: '1000.00',
    description:
      'Fiat turnover of successful deals (success and success_changed) over all time',
  })
  turnoverTotal: string;

  @ApiProperty({
    type: String,
    example: '1000.00',
    description:
      'Fiat turnover of deals that succeeded since the start of the current day in BUSINESS_TIMEZONE',
  })
  turnoverToday: string;

  @ApiProperty({
    type: String,
    example: '1000.00',
    description:
      'Fiat turnover of deals that succeeded since the start of the current month in BUSINESS_TIMEZONE',
  })
  turnoverMonth: string;
}

export const toBankDetailsDto = (
  details: BankDetails,
  counterpartyMinAmount: Fiat,
  turnover: BankDetailsTurnover,
): BankDetailsDto => ({
  id: details.id,
  userId: details.userId,
  user: details.user ? toInviteAccountDto(details.user) : null,
  bankId: details.bankId,
  bank: details.bank
    ? {
        id: details.bank.id,
        bankId: details.bank.bankId,
        name: details.bank.name,
      }
    : null,
  deviceId: details.deviceId ?? null,
  device: details.device
    ? {
        id: details.device.id,
        name: details.device.name,
        status: details.device.status,
        lastActivity: details.device.lastActivity ?? null,
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
  maxActiveTransactionsEnabled: Boolean(details.maxActiveTransactionsEnabled),
  maxActiveTransactions: details.maxActiveTransactions ?? null,
  delayBetweenRequestsEnabled: Boolean(details.delayBetweenRequestsEnabled),
  delayBetweenRequests: details.delayBetweenRequests ?? null,
  counterpartyOnly: Boolean(details.counterpartyOnly),
  reserve: Boolean(details.reserve),
  active: details.active,
  bannedAt: details.bannedAt ?? null,
  bannedBy: details.bannedBy ? toInviteAccountDto(details.bannedBy) : null,
  createdAt: details.createdAt,
  trader: details.user
    ? { id: details.user.id, login: loginOf(details.user) }
    : null,
  turnoverTotal: formatFiat(turnover.total),
  turnoverToday: formatFiat(turnover.today),
  turnoverMonth: formatFiat(turnover.month),
});
