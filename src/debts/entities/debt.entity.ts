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
import { moneyColumn } from '../../common/utils/money-column';
import { User } from '../../users/entities/user.entity';

@Entity('debts')
export class Debt {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issuedByUserId' })
  issuedBy: User;

  @Column({ type: 'uuid' })
  issuedByUserId: string;

  @Column(moneyColumn())
  amount: number;

  @Column(moneyColumn())
  remaining: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  autoWriteOffAt: Date | null;

  @Column({ type: 'boolean', default: false })
  autoWriteOffPaused: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
