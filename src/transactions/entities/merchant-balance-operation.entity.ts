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
import { Crypto } from '../../common/types/crypto';
import { User } from '../../users/entities/user.entity';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { MerchantBalanceOperationType } from '../types/merchant-balance-operation-type.enum';
import { MerchantBalance } from './merchant-balance.entity';
import { Transaction } from './transaction.entity';

@Entity('merchant_balance_operations')
@Index(['transactionId', 'type'], { unique: true })
export class MerchantBalanceOperation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => MerchantBalance, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantBalanceId' })
  merchantBalance: MerchantBalance;

  @Index()
  @Column({ type: 'int' })
  merchantBalanceId: number;

  @Column({ type: 'enum', enum: MerchantBalanceOperationType })
  type: MerchantBalanceOperationType;

  @ManyToOne(() => Transaction, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction | null;

  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @Column(cryptoColumn())
  amount: Crypto;

  @Column(cryptoColumn())
  balanceBefore: Crypto;

  @Column(cryptoColumn())
  balanceAfter: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  escrowBefore: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  escrowAfter: Crypto;

  @Column({ type: 'varchar', length: 500, nullable: true })
  comment: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actorUserId' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
