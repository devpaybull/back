import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
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

  @Column()
  totpSecret: string;

  @Column({ type: 'timestamptz', nullable: true })
  twoFactorConfirmedAt: Date;

  @OneToMany(() => UserBackupCode, (code) => code.user)
  backupCodes: UserBackupCode[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
