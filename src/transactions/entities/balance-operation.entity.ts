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
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { Crypto } from '../../common/types/crypto';
import { Transaction } from './transaction.entity';
import { Wallet } from './wallet.entity';

@Entity('balance_operations')
export class BalanceOperation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Wallet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;

  @Index()
  @Column({ type: 'int' })
  walletId: number;

  @Column({ type: 'enum', enum: BalanceOperationType })
  type: BalanceOperationType;

  @Column({ type: 'enum', enum: BalanceKind })
  balanceKind: BalanceKind;

  @ManyToOne(() => Transaction, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  transactionId: string;

  @Column(cryptoColumn())
  amount: Crypto;

  @Column(cryptoColumn())
  balanceBefore: Crypto;

  @Column(cryptoColumn())
  balanceAfter: Crypto;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
