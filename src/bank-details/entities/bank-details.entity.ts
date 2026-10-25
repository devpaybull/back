import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Bank } from '../../banks/entities/bank.entity';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { Device } from '../../devices/entities/device.entity';
import { User } from '../../users/entities/user.entity';

@Entity('bank_details')
export class BankDetails {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => Bank, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankId' })
  bank: Bank;

  @Index()
  @Column({ type: 'int' })
  bankId: number;

  @ManyToOne(() => Device, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Index()
  @Column({ type: 'int', nullable: true })
  deviceId: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ nullable: true })
  cardholderName: string;

  @Column({ nullable: true })
  card: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ default: false })
  minAmountEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  minAmount: number;

  @Column({ default: false })
  maxAmountEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  maxAmount: number;

  @Column({ default: false })
  dailyLimitEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  dailyLimit: number;

  @Column({ default: false })
  monthlyLimitEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  monthlyLimit: number;

  @Column({ default: false })
  dailyAmountLimitEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  dailyAmountLimit: number;

  @Column({ default: false })
  monthlyAmountLimitEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  monthlyAmountLimit: number;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date;
}
