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
import { Merchant } from '../../merchants/entities/merchant.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { MerchantCallbackEvent } from '../types/merchant-callback-event.enum';
import { MerchantCallbackStatus } from '../types/merchant-callback-status.enum';

@Entity('merchant_callbacks')
@Index('merchant_callbacks_one_event_per_seq', ['transactionId', 'eventSeq'], {
  unique: true,
  where: `NOT "isResend"`,
})
@Index(['status', 'nextAttemptAt'])
export class MerchantCallback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column({ type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  merchantTransactionId: string | null;

  @Index()
  @Column({ type: 'uuid' })
  eventId: string;

  @Column({ type: 'int' })
  eventSeq: number;

  @Column({ type: 'enum', enum: MerchantCallbackEvent })
  event: MerchantCallbackEvent;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  url: string | null;

  @Column({ type: 'enum', enum: MerchantCallbackStatus })
  status: MerchantCallbackStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'int', nullable: true })
  lastResponseCode: number | null;

  @Column({ type: 'text', nullable: true })
  lastResponseBody: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @ManyToOne(() => MerchantCallback, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resendOfId' })
  resendOf: MerchantCallback | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  resendOfId: string | null;

  @Column({ default: false })
  isResend: boolean;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
