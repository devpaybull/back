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
import { Merchant } from './merchant.entity';

@Entity('merchant_api_keys')
@Index('merchant_api_keys_one_active_per_merchant', ['merchantId'], {
  unique: true,
  where: '"active"',
})
export class MerchantApiKey {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column({ type: 'uuid' })
  merchantId: string;

  @Index({ unique: true })
  @Column()
  key: string;

  @Column()
  secret: string;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
