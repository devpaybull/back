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
import { percentColumn } from '../../common/utils/percent-column';
import { Currency } from '../../currencies/entities/currency.entity';
import { User } from './user.entity';

@Entity('trader_leads')
@Index(['traderUserId', 'leadUserId', 'currencyId'], { unique: true })
export class TraderLead {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'traderUserId' })
  trader: User;

  @Column({ type: 'uuid' })
  traderUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leadUserId' })
  lead: User;

  @Index()
  @Column({ type: 'uuid' })
  leadUserId: string;

  @ManyToOne(() => Currency, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ type: 'int' })
  currencyId: number;

  @Column(percentColumn())
  payInPercent: number;

  @Column(percentColumn())
  payOutPercent: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
