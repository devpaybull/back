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

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploadedByUserId' })
  uploadedBy: User;

  @Column({ type: 'uuid' })
  uploadedByUserId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
