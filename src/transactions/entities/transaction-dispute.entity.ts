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
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { User } from '../../users/entities/user.entity';
import { DisputeStatus } from '../types/dispute-status.enum';
import { DisputeTraderAction } from '../types/dispute-trader-action.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { Transaction } from './transaction.entity';

@Entity('transaction_disputes')
@Index('transaction_disputes_one_live_per_deal', ['transactionId'], {
  unique: true,
  where: `"status" IN ('deferred', 'open', 'reviewing')`,
})
export class TransactionDispute {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  @Index()
  @Column({ type: 'enum', enum: DisputeStatus })
  status: DisputeStatus;

  @Column({ type: 'enum', enum: TransactionStatus })
  statusBefore: TransactionStatus;

  @Column(fiatColumn({ nullable: true }))
  amountFiat: Fiat | null;

  @Column({ type: 'text', nullable: true })
  declineReason: string | null;

  @Column({ type: 'timestamptz' })
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolvedByUserId' })
  resolvedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  traderDeadlineAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  traderRespondedAt: Date | null;

  @Column({ type: 'enum', enum: DisputeTraderAction, nullable: true })
  traderAction: DisputeTraderAction | null;

  @Column({ type: 'text', nullable: true })
  traderComment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
