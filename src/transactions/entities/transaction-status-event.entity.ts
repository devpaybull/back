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
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { Transaction } from './transaction.entity';

@Entity('transaction_status_events')
export class TransactionStatusEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  @Column({ type: 'enum', enum: TransactionStatus, nullable: true })
  fromStatus: TransactionStatus;

  @Column({ type: 'enum', enum: TransactionStatus })
  toStatus: TransactionStatus;

  @Column({ type: 'enum', enum: StatusEventSource })
  source: StatusEventSource;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actorUserId' })
  actor: User;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
