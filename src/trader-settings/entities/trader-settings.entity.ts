import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyColumn } from '../../common/utils/money-column';
import { User } from '../../users/entities/user.entity';

@Entity('trader_settings')
export class TraderSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ default: false })
  tradingEnabled: boolean;

  @Column({ default: false })
  payoutTradingEnabled: boolean;

  @Column({ default: false })
  individualRatesEnabled: boolean;

  @Column({ default: false })
  autoBuybackEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  autoBuybackConcurrent: number;

  @Column({ default: false })
  payInAntifraudEnabled: boolean;

  @Column({ default: false })
  qrBuybackAccess: boolean;

  @Column({ default: false })
  userTransferAccess: boolean;

  @Column({ default: false })
  trustedUser: boolean;

  @Column(moneyColumn({ nullable: true }))
  insurancePayInMin: number | null;

  @Column(moneyColumn({ nullable: true }))
  insurancePayOutMin: number | null;

  @Column({ default: true })
  nightStopEnabled: boolean;

  @Column({ type: 'int', nullable: true })
  nightStopThreshold: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
