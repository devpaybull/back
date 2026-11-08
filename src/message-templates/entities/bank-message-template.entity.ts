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
import { Bank } from '../../banks/entities/bank.entity';
import { BankMessageType } from '../types/bank-message-type.enum';

@Entity('bank_message_templates')
export class BankMessageTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Bank, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankId' })
  bank: Bank;

  @Index()
  @Column({ type: 'int' })
  bankId: number;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  sender: string;

  @Column({ type: 'enum', enum: BankMessageType })
  messageType: BankMessageType;

  @Column({ type: 'text' })
  pattern: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
