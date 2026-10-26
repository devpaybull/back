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
import { Crypto } from '../../common/types/crypto';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { User } from '../../users/entities/user.entity';

@Entity('withdrawal_quotes')
@Index(['userId', 'address', 'expiresAt'])
export class WithdrawalQuote {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Column(cryptoColumn())
  amount: Crypto;

  @Column(cryptoColumn())
  fee: Crypto;

  @Column(cryptoColumn())
  feeTrx: Crypto;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
