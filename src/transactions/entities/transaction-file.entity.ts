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
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionDispute } from './transaction-dispute.entity';
import { Transaction } from './transaction.entity';

@Entity('transaction_files')
export class TransactionFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Transaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  @Column({ type: 'enum', enum: TransactionFileKind })
  kind: TransactionFileKind;

  @Column({ type: 'varchar', unique: true })
  storageKey: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar' })
  mime: string;

  @Column({ type: 'int' })
  size: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploadedByUserId' })
  uploadedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @ManyToOne(() => TransactionDispute, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'disputeId' })
  dispute: TransactionDispute | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  disputeId: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
