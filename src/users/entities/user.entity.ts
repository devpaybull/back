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
import { Role } from '../../common/enums/role.enum';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { UserStatus } from '../types/user-status.enum';
import { UserBackupCode } from './user-backup-code.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ nullable: true })
  email: string;

  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  @Index({ unique: true })
  @Column({ nullable: true })
  telegramUsername: string;

  @Index({ unique: true })
  @Column({ type: 'bigint', nullable: true })
  telegramId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramGroups: string | null;

  @Column()
  passwordHash: string;

  @Column({ type: 'enum', enum: Role })
  role: Role;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PendingTwoFactor,
  })
  status: UserStatus;

  @ManyToOne(() => Merchant, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  merchantId: string;

  @Column()
  totpSecret: string;

  @Column({ type: 'timestamptz', nullable: true })
  twoFactorConfirmedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  twoFactorResetAt: Date | null;

  @Column({ type: 'int', nullable: true })
  withdrawalTotpLastStep: number | null;

  @Column({ type: 'int', default: 0 })
  withdrawalTotpFailures: number;

  @Column({ type: 'timestamptz', nullable: true })
  withdrawalTotpFailuresSince: Date | null;

  @OneToMany(() => UserBackupCode, (code) => code.user)
  backupCodes: UserBackupCode[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
