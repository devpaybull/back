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
import { Merchant } from './merchant.entity';

@Entity('merchant_currencies')
@Index(['merchantId', 'currencyId'], { unique: true })
export class MerchantCurrency {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Column({ type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Currency, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ type: 'int' })
  currencyId: number;

  @Column(percentColumn({ default: 0 }))
  payInMarkupPercent: number;

  @Column(percentColumn({ default: 0 }))
  payOutMarkupPercent: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
