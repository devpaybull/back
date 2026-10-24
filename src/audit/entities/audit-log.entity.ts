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
import { AuditSource } from '../types/audit-source.enum';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: AuditSource, default: AuditSource.Domain })
  source: AuditSource;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actorUserId' })
  actor: User;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'impersonatorUserId' })
  impersonator: User;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  impersonatorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'targetUserId' })
  target: User;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  targetUserId: string | null;

  @Column()
  action: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  method: string | null;

  @Column({ type: 'text', nullable: true })
  path: string | null;

  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', nullable: true })
  login: string | null;

  @Column({ type: 'jsonb', nullable: true })
  body: unknown;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
