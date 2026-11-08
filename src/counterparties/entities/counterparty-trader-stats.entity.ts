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
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { User } from '../../users/entities/user.entity';
import { Counterparty } from './counterparty.entity';

@Entity('counterparty_trader_stats')
@Index(['counterpartyId', 'traderUserId'], { unique: true })
export class CounterpartyTraderStats {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Counterparty, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'counterpartyId' })
  counterparty: Counterparty;

  @Column({ type: 'int' })
  counterpartyId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'traderUserId' })
  trader: User;

  @Index()
  @Column({ type: 'uuid' })
  traderUserId: string;

  @Column({ type: 'int', default: 0 })
  completedCount: number;

  @Column({ type: 'int', default: 0 })
  paidCount: number;

  @Column(fiatColumn({ default: 0 }))
  paidAmount: Fiat;

  @Column({ type: 'timestamptz', nullable: true })
  lastPaidAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastDealAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
