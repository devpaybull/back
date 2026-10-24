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
import { User } from '../../users/entities/user.entity';
import { moneyColumn } from '../../common/utils/money-column';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @Column(moneyColumn({ default: 0 }))
  mainBalance: number;

  @Column(moneyColumn({ default: 0 }))
  mainReserved: number;

  @Column(moneyColumn({ default: 0 }))
  insurancePayInBalance: number;

  @Column(moneyColumn({ default: 0 }))
  insurancePayOutBalance: number;

  @Column(moneyColumn({ default: 0 }))
  insurancePayInReserved: number;

  @Column(moneyColumn({ default: 0 }))
  insurancePayOutReserved: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastAcceptedDealAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
