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
import { TronAddress } from '../../tron/entities/tron-address.entity';
import { User } from '../../users/entities/user.entity';

@Entity('deposit_addresses')
export class DepositAddress {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => TronAddress, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tronAddressId' })
  tronAddress: TronAddress;

  @Index({ unique: true })
  @Column({ type: 'int' })
  tronAddressId: number;

  @Column({ type: 'varchar', length: 34 })
  address: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
