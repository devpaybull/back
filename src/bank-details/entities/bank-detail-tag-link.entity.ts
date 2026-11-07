import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BankDetailTag } from './bank-detail-tag.entity';
import { BankDetails } from './bank-details.entity';

@Entity('bank_detail_tag_links')
export class BankDetailTagLink {
  @ManyToOne(() => BankDetails, (details) => details.tagLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bankDetailsId' })
  bankDetails: BankDetails;

  @PrimaryColumn({ type: 'uuid' })
  bankDetailsId: string;

  @ManyToOne(() => BankDetailTag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag: BankDetailTag;

  @Index()
  @PrimaryColumn({ type: 'int' })
  tagId: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
