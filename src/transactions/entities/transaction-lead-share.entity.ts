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
import { moneyColumn } from '../../common/utils/money-column';
import { percentColumn } from '../../common/utils/percent-column';
import { User } from '../../users/entities/user.entity';
import { Transaction } from './transaction.entity';

@Entity('transaction_lead_shares')
@Index(['transactionId', 'leadUserId'], { unique: true })
export class TransactionLeadShare {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Column({ type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leadUserId' })
  lead: User;

  @Index()
  @Column({ type: 'uuid' })
  leadUserId: string;

  @Column(percentColumn())
  percent: number;

  @Column(moneyColumn())
  amount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
