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
import { cryptoColumn } from '../../common/utils/crypto-column';
import { AccountTransaction } from './account-transaction.entity';

@Entity('deposit_transfers')
@Index(['txHash', 'logIndex'], { unique: true })
export class DepositTransfer {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AccountTransaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountTransactionId' })
  accountTransaction: AccountTransaction;

  @Index()
  @Column({ type: 'int' })
  accountTransactionId: number;

  @Column({ type: 'varchar', length: 64 })
  txHash: string;

  @Column({ type: 'int' })
  logIndex: number;

  @Column({ type: 'varchar', length: 34 })
  fromAddress: string;

  @Column(cryptoColumn())
  amount: Crypto;

  @Column({ type: 'bigint' })
  blockNumber: string;

  @Column({ type: 'timestamptz' })
  blockTime: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
