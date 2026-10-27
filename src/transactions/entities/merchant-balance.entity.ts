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
import { Crypto } from '../../common/types/crypto';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { Merchant } from '../../merchants/entities/merchant.entity';

@Entity('merchant_balances')
export class MerchantBalance {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => Merchant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  merchantId: string;

  @Column(cryptoColumn({ default: 0 }))
  balance: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  escrow: Crypto;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
