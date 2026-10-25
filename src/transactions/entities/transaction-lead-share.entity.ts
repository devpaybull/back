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
import { cryptoColumn } from '../../common/utils/crypto-column';
import { Crypto } from '../../common/types/crypto';
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

  @Column(cryptoColumn())
  amount: Crypto;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
