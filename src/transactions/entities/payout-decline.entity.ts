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
import { User } from '../../users/entities/user.entity';
import { PayoutDeclineKind } from '../types/payout-decline-kind.enum';
import { PayoutDeclineReason } from '../types/payout-decline-reason.enum';
import { Transaction } from './transaction.entity';

@Entity('payout_declines')
export class PayoutDecline {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'traderUserId' })
  trader: User;

  @Index()
  @Column({ type: 'uuid' })
  traderUserId: string;

  @Column({ type: 'enum', enum: PayoutDeclineKind })
  kind: PayoutDeclineKind;

  @Column({ type: 'enum', enum: PayoutDeclineReason, nullable: true })
  reasonCode: PayoutDeclineReason | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
