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
import { User } from '../../users/entities/user.entity';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { Crypto } from '../../common/types/crypto';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @Column(cryptoColumn({ default: 0 }))
  mainBalance: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  mainReserved: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  insurancePayInBalance: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  insurancePayOutBalance: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  insurancePayInReserved: Crypto;

  @Column(cryptoColumn({ default: 0 }))
  insurancePayOutReserved: Crypto;

  @Column({ type: 'timestamptz', nullable: true })
  lastAcceptedDealAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
