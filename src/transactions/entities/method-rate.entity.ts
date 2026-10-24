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
import { Merchant } from '../../merchants/entities/merchant.entity';
import { User } from '../../users/entities/user.entity';
import { RateScope } from '../types/rate-scope.enum';
import { TransactionMethod } from '../types/transaction-method';
import { moneyColumn } from '../../common/utils/money-column';
import { percentColumn } from '../../common/utils/percent-column';

@Entity('method_rates')
export class MethodRate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: RateScope })
  scope: RateScope;

  @Index()
  @Column({ type: 'varchar' })
  method: TransactionMethod;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subjectUserId' })
  subjectUser: User;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subjectUserId: string;

  @ManyToOne(() => Merchant, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subjectMerchantId' })
  subjectMerchant: Merchant;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subjectMerchantId: string;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankId' })
  bank: Bank;

  @Index()
  @Column({ type: 'int', nullable: true })
  bankId: number;

  @Column(moneyColumn({ nullable: true }))
  fromAmount: number;

  @Column(moneyColumn({ nullable: true }))
  toAmount: number;

  @Column(percentColumn())
  payInPercent: number;

  @Column(percentColumn())
  payOutPercent: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
