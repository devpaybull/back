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
import { TronOutgoingTransfer } from '../../tron/entities/tron-outgoing-transfer.entity';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { AccountTransaction } from './account-transaction.entity';

@Entity('withdrawal_attempts')
export class WithdrawalAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => AccountTransaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountTransactionId' })
  accountTransaction: AccountTransaction;

  @Index()
  @Column({ type: 'int' })
  accountTransactionId: number;

  @ManyToOne(() => TronOutgoingTransfer, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'outgoingTransferId' })
  outgoingTransfer: TronOutgoingTransfer | null;

  @Index({ unique: true })
  @Column({ type: 'int', nullable: true })
  outgoingTransferId: number | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  txHash: string | null;

  @Column({ type: 'enum', enum: OutgoingTransferStatus })
  status: OutgoingTransferStatus;

  @Column(cryptoColumn({ nullable: true }))
  amountSent: Crypto | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
