import { ApiProperty } from '@nestjs/swagger';
import { CounterpartyHealth } from '../../counterparties/types/counterparty-health.enum';
import { CounterpartyBindingDto } from './counterparty-binding.dto';
import { UserMerchantDto } from './user-merchant.dto';

export class CounterpartyDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'The client id the merchant knows it by' })
  externalId: string;

  @ApiProperty({ type: UserMerchantDto, nullable: true })
  merchant: UserMerchantDto | null;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ nullable: true })
  contact: string | null;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty()
  blacklisted: boolean;

  @ApiProperty({ nullable: true })
  blacklistedAt: Date | null;

  @ApiProperty()
  autoEnableForbidden: boolean;

  @ApiProperty({ enum: CounterpartyHealth })
  health: CounterpartyHealth;

  @ApiProperty({ type: CounterpartyBindingDto, nullable: true })
  binding: CounterpartyBindingDto | null;

  @ApiProperty({ description: 'Pay-ins that have ever been in dispute' })
  disputes: number;

  @ApiProperty({ description: 'Pay-ins created' })
  dealCount: number;

  @ApiProperty({ description: 'Pay-ins that ended: paid or canceled' })
  completedCount: number;

  @ApiProperty({ description: 'Pay-ins paid: success or success_changed' })
  paidCount: number;

  @ApiProperty({
    description:
      'Deal-creation requests of the client that reached the counterparty lookup (pay-in step 7), refusals included; kept when the log is purged',
  })
  requestCount: number;

  @ApiProperty({
    nullable: true,
    description:
      'Paid of completed, percent with two decimals; null with none completed',
  })
  conversion: number | null;

  @ApiProperty({
    nullable: true,
    description:
      '«Последний вход»: when the latest such request arrived; null with none',
  })
  lastLoginAt: Date | null;

  @ApiProperty({ nullable: true })
  lastDepositAt: Date | null;

  @ApiProperty({ type: String, nullable: true, example: '200000.00' })
  averageCheck: string | null;

  @ApiProperty({ type: String, example: '200000.00' })
  volume7d: string;

  @ApiProperty({ type: String, example: '1000000.00' })
  volume30d: string;

  @ApiProperty({ type: String, example: '15000000.00' })
  volumeTotal: string;

  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty()
  createdAt: Date;
}
