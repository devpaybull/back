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
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { percentColumn } from '../../common/utils/percent-column';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { TransactionMethod } from '../types/transaction-method';

@Entity('lead_rates')
export class LeadRate {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => TraderLead, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'traderLeadId' })
  traderLead: TraderLead;

  @Index()
  @Column({ type: 'int' })
  traderLeadId: number;

  @Column({ type: 'varchar' })
  method: TransactionMethod;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankId' })
  bank: Bank;

  @Index()
  @Column({ type: 'int', nullable: true })
  bankId: number;

  @Column(fiatColumn({ nullable: true }))
  fromAmount: Fiat;

  @Column(fiatColumn({ nullable: true }))
  toAmount: Fiat;

  @Column(percentColumn())
  payInPercent: number;

  @Column(percentColumn())
  payOutPercent: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
