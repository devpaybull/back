import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { DeviceStatus } from '../../devices/types/device-status.enum';
import { BankDetails } from '../entities/bank-details.entity';

export class OwnBankDetailsBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  bankId: string;

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

  @ApiProperty()
  bankId: number;

  @ApiPropertyOptional({ type: OwnBankDetailsBankDto, nullable: true })
  bank: OwnBankDetailsBankDto;

  @ApiPropertyOptional({ nullable: true })
  deviceId: number;

  @ApiPropertyOptional({ type: OwnBankDetailsDeviceDto, nullable: true })
  device: OwnBankDetailsDeviceDto;

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
    nullable: true,
    description:
      'While counterpartyOnly is set this is the configured floor, not a stored value',
  })
  minAmount: number;

  @ApiProperty()
  maxAmountEnabled: boolean;

  @ApiPropertyOptional({ nullable: true })
  maxAmount: number;

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

  @ApiPropertyOptional({ nullable: true, description: 'Turnover a day' })
  dailyAmountLimit: number;

  @ApiProperty()
  monthlyAmountLimitEnabled: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Turnover a month' })
  monthlyAmountLimit: number;

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

  @ApiPropertyOptional({
    nullable: true,
    description: 'Set by an administrator; the owner cannot lift it',
  })
  bannedAt: Date;

  @ApiProperty()
  createdAt: Date;
}

export const toOwnBankDetailsDto = (
  details: BankDetails,
  counterpartyMinAmount: number,
): OwnBankDetailsDto => ({
  id: details.id,
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
      }
    : null,
  type: details.type,
  cardholderName: details.cardholderName ?? null,
  card: details.card ?? null,
  phone: details.phone ?? null,
  minAmountEnabled: details.counterpartyOnly
    ? true
    : Boolean(details.minAmountEnabled),
  minAmount: details.counterpartyOnly
    ? counterpartyMinAmount
    : (details.minAmount ?? null),
  maxAmountEnabled: Boolean(details.maxAmountEnabled),
  maxAmount: details.maxAmount ?? null,
  dailyLimitEnabled: Boolean(details.dailyLimitEnabled),
  dailyLimit: details.dailyLimit ?? null,
  monthlyLimitEnabled: Boolean(details.monthlyLimitEnabled),
  monthlyLimit: details.monthlyLimit ?? null,
  dailyAmountLimitEnabled: Boolean(details.dailyAmountLimitEnabled),
  dailyAmountLimit: details.dailyAmountLimit ?? null,
  monthlyAmountLimitEnabled: Boolean(details.monthlyAmountLimitEnabled),
  monthlyAmountLimit: details.monthlyAmountLimit ?? null,
  maxActiveTransactionsEnabled: Boolean(details.maxActiveTransactionsEnabled),
  maxActiveTransactions: details.maxActiveTransactions ?? null,
  delayBetweenRequestsEnabled: Boolean(details.delayBetweenRequestsEnabled),
  delayBetweenRequests: details.delayBetweenRequests ?? null,
  counterpartyOnly: Boolean(details.counterpartyOnly),
  reserve: Boolean(details.reserve),
  active: details.active,
  bannedAt: details.bannedAt ?? null,
  createdAt: details.createdAt,
});
