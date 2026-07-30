import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';

@Entity('invites')
export class Invite {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ nullable: true })
  email: string;

  @Index()
  @Column({ nullable: true })
  telegramUsername: string;

  @Column({ type: 'enum', enum: Role })
  role: Role;

  @Index({ unique: true })
  @Column()
  code: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy: User;

  @Column({ type: 'uuid' })
  createdByUserId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'usedByUserId' })
  usedBy: User;

  @Column({ type: 'uuid', nullable: true })
  usedByUserId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'revokedByUserId' })
  revokedBy: User;

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
