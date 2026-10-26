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
import { Crypto } from '../../common/types/crypto';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { TronAddress } from '../../tron/entities/tron-address.entity';
import { User } from '../../users/entities/user.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

@Entity('account_transactions')
@Index(['type', 'status'])
@Check(
  'account_transactions_counterparty_only_on_transfer',
  `("type" = 'transfer') = ("counterpartyUserId" IS NOT NULL)`,
)
@Check(
  'account_transactions_withdrawal_fields',
  `"type" = 'withdrawal' OR ("fee" IS NULL AND "paidManually" IS NULL)`,
)
@Check(
  'account_transactions_deposit_fields',
  `"type" = 'deposit' OR ("addressId" IS NULL AND "expiresAt" IS NULL AND "amountReceived" IS NULL)`,
)
@Check(
  'account_transactions_withdrawal_address',
  `"type" <> 'withdrawal' OR "address" IS NOT NULL`,
)
export class AccountTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: AccountTransactionType })
  type: AccountTransactionType;

  @Column({ type: 'enum', enum: AccountTransactionStatus })
  status: AccountTransactionStatus;

  @Column({
    type: 'enum',
    enum: AccountTransactionStatusReason,
    nullable: true,
  })
  statusReason: AccountTransactionStatusReason | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counterpartyUserId' })
  counterparty: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  counterpartyUserId: string | null;

  @Column(cryptoColumn({ nullable: true }))
  amount: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  amountReceived: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  creditedAmount: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  fee: Crypto | null;

  @Index()
  @Column({ type: 'varchar', length: 34, nullable: true })
  address: string | null;

  @ManyToOne(() => TronAddress, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'addressId' })
  tronAddress: TronAddress | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  addressId: number | null;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  txHash: string | null;

  @Column({ type: 'boolean', nullable: true })
  paidManually: boolean | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actorUserId' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
