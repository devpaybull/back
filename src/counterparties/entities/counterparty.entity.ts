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
import { Merchant } from '../../merchants/entities/merchant.entity';

@Entity('counterparties')
@Index(['merchantId', 'externalId'], { unique: true })
export class Counterparty {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Merchant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column({ type: 'uuid' })
  merchantId: string;

  @Column()
  externalId: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  contact: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
