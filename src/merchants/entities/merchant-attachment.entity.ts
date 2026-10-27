import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { MerchantAttachmentKind } from '../types/merchant-attachment-kind.enum';
import { MerchantAttachmentMethod } from './merchant-attachment-method.entity';
import { Merchant } from './merchant.entity';

@Entity('merchant_attachments')
@Index(['merchantId', 'userId'], { unique: true })
export class MerchantAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Column({ type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: MerchantAttachmentKind })
  kind: MerchantAttachmentKind;

  @Column()
  trading: boolean;

  @OneToMany(() => MerchantAttachmentMethod, (method) => method.attachment)
  methods: MerchantAttachmentMethod[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
