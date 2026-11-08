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
import { Counterparty } from './counterparty.entity';

@Entity('counterparty_daily_requests')
@Index(['counterpartyId', 'day'], { unique: true })
export class CounterpartyDailyRequest {
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
  requestCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
