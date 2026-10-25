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
import { cryptoColumn } from '../../common/utils/crypto-column';
import { Crypto } from '../../common/types/crypto';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { User } from '../../users/entities/user.entity';
import { DebtEventType } from '../types/debt-event-type.enum';
import { Debt } from './debt.entity';

@Entity('debt_events')
export class DebtEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Debt, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'debtId' })
  debt: Debt;

  @Index()
  @Column({ type: 'int' })
  debtId: number;

  @Column({ type: 'enum', enum: DebtEventType })
  type: DebtEventType;

  @Column(cryptoColumn())
  amount: Crypto;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actorUserId' })
  actor: User | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => BalanceOperation, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'balanceOperationId' })
  balanceOperation: BalanceOperation | null;

  @Column({ type: 'int', nullable: true })
  balanceOperationId: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
