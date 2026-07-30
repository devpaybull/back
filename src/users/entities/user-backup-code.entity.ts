import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_backup_codes')
export class UserBackupCode {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, (user) => user.backupCodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  codeHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
