import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { fiatColumn } from '../../common/utils/fiat-column';
import { Currency } from '../../currencies/entities/currency.entity';
import { MerchantRateCalculation } from '../types/merchant-rate-calculation.enum';
import { MerchantRateSource } from '../types/merchant-rate-source.enum';
import { Merchant } from './merchant.entity';

@Entity('merchant_settings')
export class MerchantSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Currency, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'defaultCurrencyId' })
  defaultCurrency: Currency | null;

  @Column({ type: 'int', nullable: true })
  defaultCurrencyId: number | null;

  @Column(fiatColumn({ nullable: true }))
  minPayInAmount: Fiat | null;

  @Column({ type: 'int', nullable: true })
  payInWindowMinutes: number | null;

  @Column({ type: 'int', default: 0 })
  randomizationWindow: number;

  @Column({ default: false })
  sameRequestsEnabled: boolean;

  @Column({ default: false })
  telegramAlertEnabled: boolean;

  @Column({ default: false })
  failedDealsLimitEnabled: boolean;

  @Column({ type: 'int', default: 5 })
  failedDealsPerHour: number;

  @Column({ default: false })
  payoutOverdraftEnabled: boolean;

  @Column({ default: false })
  autoPayoutEnabled: boolean;

  @Column({ type: 'varchar', length: 34, nullable: true })
  autoPayoutAddress: string | null;

  @Column(cryptoColumn({ nullable: true }))
  autoPayoutAmount: Crypto | null;

  @Column(cryptoColumn({ default: 0 }))
  withdrawalFee: Crypto;

  @Column({ default: false })
  withdrawalFeeWaived: boolean;

  @Column({
    type: 'enum',
    enum: MerchantRateSource,
    default: MerchantRateSource.RapiraPlus1,
  })
  rateSource: MerchantRateSource;

  @Column({
    type: 'enum',
    enum: MerchantRateCalculation,
    default: MerchantRateCalculation.ByCrypto,
  })
  rateCalculation: MerchantRateCalculation;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  callbackUrl: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  successUrl: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  errorUrl: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  supportLink: string | null;

  @Column({ default: false })
  ipCheckEnabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
