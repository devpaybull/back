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
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { User } from '../../users/entities/user.entity';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';

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

  @Index()
  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  blacklistedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'blacklistedByUserId' })
  blacklistedBy: User;

  @Column({ type: 'uuid', nullable: true })
  blacklistedByUserId: string | null;

  @Column({ default: false })
  autoEnableForbidden: boolean;

  @ManyToOne(() => BankDetails, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankDetailsId' })
  bankDetails: BankDetails;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  bankDetailsId: string | null;

  @Column({ type: 'enum', enum: CounterpartyBindingType, nullable: true })
  bindingType: CounterpartyBindingType | null;

  @Column({ type: 'timestamptz', nullable: true })
  boundAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'boundByUserId' })
  boundBy: User;

  @Column({ type: 'uuid', nullable: true })
  boundByUserId: string | null;

  @Column({ type: 'int', default: 0 })
  dealCount: number;

  @Column({ type: 'int', default: 0 })
  completedCount: number;

  @Column({ type: 'int', default: 0 })
  paidCount: number;

  @Column({ type: 'int', default: 0 })
  disputeCount: number;

  @Column(fiatColumn({ default: 0 }))
  paidAmount: Fiat;

  @Column({ type: 'timestamptz', nullable: true })
  lastDepositAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
