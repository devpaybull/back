import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Bank } from '../../banks/entities/bank.entity';
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { Device } from '../../devices/entities/device.entity';
import { MobileOperator } from '../../mobile-operators/entities/mobile-operator.entity';
import { User } from '../../users/entities/user.entity';
import { BankDetailsType } from '../types/bank-details-type.enum';
import { DELAY_BETWEEN_REQUESTS_SECONDS } from '../utils/delay-between-requests-seconds';
import { BankDetailTagLink } from './bank-detail-tag-link.entity';

@Entity('bank_details')
@Check(
  'bank_details_bank_unless_mobile',
  `("type" = 'mobile') = ("bankId" IS NULL)`,
)
@Check(
  'bank_details_operator_only_on_mobile',
  `("type" = 'mobile') = ("mobileOperatorId" IS NOT NULL)`,
)
@Check(
  'bank_details_daily_amount_limit_always_on',
  `"dailyAmountLimitEnabled" AND "dailyAmountLimit" IS NOT NULL`,
)
@Check(
  'bank_details_max_counterparties_only_on_counterparty_only',
  `"counterpartyOnly" = ("maxCounterparties" IS NOT NULL)`,
)
@Check(
  'bank_details_delay_between_requests_from_the_set',
  `"delayBetweenRequests" IS NULL OR "delayBetweenRequests" IN (${DELAY_BETWEEN_REQUESTS_SECONDS.join(', ')})`,
)
export class BankDetails {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankId' })
  bank: Bank;

  @Index()
  @Column({ type: 'int', nullable: true })
  bankId: number;

  @ManyToOne(() => MobileOperator, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'mobileOperatorId' })
  mobileOperator: MobileOperator;

  @Index()
  @Column({ type: 'int', nullable: true })
  mobileOperatorId: number;

  @ManyToOne(() => Device, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Index()
  @Column({ type: 'int' })
  deviceId: number;

  @Column({ type: 'enum', enum: BankDetailsType })
  type: BankDetailsType;

  @Column({ nullable: true })
  cardholderName: string;

  @Column({ nullable: true })
  card: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ default: false })
  minAmountEnabled: boolean;

  @Column(fiatColumn({ nullable: true }))
  minAmount: Fiat;

  @Column({ default: false })
  maxAmountEnabled: boolean;

  @Column(fiatColumn({ nullable: true }))
  maxAmount: Fiat;

  @Column({ default: false })
  dailyLimitEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  dailyLimit: number;

  @Column({ default: false })
  monthlyLimitEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  monthlyLimit: number;

  @Column({ default: true })
  dailyAmountLimitEnabled: boolean;

  @Column(fiatColumn())
  dailyAmountLimit: Fiat;

  @Column({ default: false })
  hourlyAmountLimitEnabled: boolean;

  @Column(fiatColumn({ nullable: true }))
  hourlyAmountLimit: Fiat;

  @Column({ default: false })
  monthlyAmountLimitEnabled: boolean;

  @Column(fiatColumn({ nullable: true }))
  monthlyAmountLimit: Fiat;

  @Column({ default: false })
  maxActiveTransactionsEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  maxActiveTransactions: number;

  @Column({ default: false })
  delayBetweenRequestsEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  delayBetweenRequests: number;

  @Column({ default: false })
  counterpartyOnly: boolean;

  @Column({ type: 'int', nullable: true })
  maxCounterparties: number;

  @Column({ default: false })
  sameBankOnly: boolean;

  @Column({ default: false })
  reserve: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  bannedAt: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bannedByUserId' })
  bannedBy: User;

  @Column({ type: 'uuid', nullable: true })
  bannedByUserId: string;

  @OneToMany(() => BankDetailTagLink, (link) => link.bankDetails)
  tagLinks: BankDetailTagLink[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date;
}
