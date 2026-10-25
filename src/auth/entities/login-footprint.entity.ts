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
import { User } from '../../users/entities/user.entity';

@Entity('login_footprints')
@Index(['userId', 'ip', 'fingerprint', 'userAgent'], { unique: true })
@Index(['ip', 'fingerprint', 'userAgent'])
export class LoginFootprint {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 128, default: '' })
  fingerprint: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  userAgent: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
