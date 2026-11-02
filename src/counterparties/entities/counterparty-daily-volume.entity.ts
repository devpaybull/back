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
import { Counterparty } from './counterparty.entity';

@Entity('counterparty_daily_volumes')
@Index(['counterpartyId', 'day'], { unique: true })
export class CounterpartyDailyVolume {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Counterparty, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'counterpartyId' })
  counterparty: Counterparty;

  @Column({ type: 'int' })
  counterpartyId: number;

  @Column({ type: 'date' })
  day: string;

  @Column({ type: 'int', default: 0 })
  paidCount: number;

  @Column(fiatColumn({ default: 0 }))
  paidAmount: Fiat;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
