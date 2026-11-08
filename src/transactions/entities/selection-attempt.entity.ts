import {
  Check,
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
import { User } from '../../users/entities/user.entity';
import { SelectionFilter } from '../types/selection-filter.enum';
import { SelectionOutcome } from '../types/selection-outcome.enum';
import { TransactionMethod } from '../types/transaction-method';
import { Transaction } from './transaction.entity';

@Entity('selection_attempts')
@Index(['traderUserId', 'createdAt'])
@Check(
  'selection_attempts_reason_only_when_skipped',
  `("outcome" = 'skipped') = ("reason" IS NOT NULL)`,
)
export class SelectionAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  requestId: string | null;

  @ManyToOne(() => Transaction, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'traderUserId' })
  trader: User;

  @Column({ type: 'uuid' })
  traderUserId: string;

  @ManyToOne(() => BankDetails, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankDetailsId' })
  bankDetails: BankDetails;

  @Index()
  @Column({ type: 'uuid' })
  bankDetailsId: string;

  @Column({ type: 'varchar', nullable: true })
  method: TransactionMethod | null;

  @Column({ type: 'enum', enum: SelectionOutcome })
  outcome: SelectionOutcome;

  @Column({ type: 'enum', enum: SelectionFilter, nullable: true })
  reason: SelectionFilter | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
