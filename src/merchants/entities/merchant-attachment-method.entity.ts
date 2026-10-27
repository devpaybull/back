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
import { MerchantAttachment } from './merchant-attachment.entity';

@Entity('merchant_attachment_methods')
@Index(['attachmentId', 'method'], { unique: true })
export class MerchantAttachmentMethod {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => MerchantAttachment, (attachment) => attachment.methods, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attachmentId' })
  attachment: MerchantAttachment;

  @Column({ type: 'int' })
  attachmentId: number;

  @Column({ type: 'varchar' })
  method: string;

  @Column()
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
