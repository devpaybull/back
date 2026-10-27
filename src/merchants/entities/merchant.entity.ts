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
import { MerchantGroup } from './merchant-group.entity';

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  internalName: string | null;

  @Column({ default: true })
  active: boolean;

  @Column({ default: false })
  exclusiveTopUp: boolean;

  @ManyToOne(() => MerchantGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'groupId' })
  group: MerchantGroup | null;

  @Index()
  @Column({ type: 'int', nullable: true })
  groupId: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
