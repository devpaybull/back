import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { User } from '../../users/entities/user.entity';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionMethod } from '../types/transaction-method';
import { TransactionStatus } from '../types/transaction-status.enum';
import { moneyColumn } from '../../common/utils/money-column';
import { percentColumn } from '../../common/utils/percent-column';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TransactionKind })
  kind: TransactionKind;

  @Index()
  @Column({ type: 'enum', enum: TransactionStatus })
  status: TransactionStatus;

  @Column({ type: 'varchar', nullable: true })
  method: TransactionMethod;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'traderUserId' })
  trader: User;

  @Index()
  @Column({ type: 'uuid' })
  traderUserId: string;

  @ManyToOne(() => BankDetails, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankDetailsId' })
  bankDetails: BankDetails;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  bankDetailsId: string;

  @ManyToOne(() => Counterparty, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counterpartyId' })
  counterparty: Counterparty;

  @Index()
  @Column({ type: 'int', nullable: true })
  counterpartyId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recipientUserId' })
  recipient: User;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  recipientUserId: string;

  @ManyToOne(() => Merchant, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  merchantId: string;

  @Column(moneyColumn({ nullable: true }))
  amountFiat: number;

  @Column(moneyColumn())
  amountCrypto: number;

  @Column(moneyColumn({ nullable: true }))
  rate: number;

  @Column(percentColumn({ nullable: true }))
  merchantPercent: number;

  @Column(percentColumn({ nullable: true }))
  traderPercent: number;

  @Column(percentColumn({ nullable: true }))
  traderEffectivePercent: number;

  @Column(percentColumn({ nullable: true }))
  leadPercent: number;

  @Column(moneyColumn({ nullable: true }))
  merchantCommission: number;

  @Column(moneyColumn({ nullable: true }))
  traderCommission: number;

  @Column(moneyColumn({ nullable: true }))
  leadCommission: number;

  @Column(moneyColumn({ nullable: true }))
  traderAmount: number;

  @Column(moneyColumn({ nullable: true }))
  merchantAmount: number;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
