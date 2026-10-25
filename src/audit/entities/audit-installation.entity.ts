import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('audit_installation')
export class AuditInstallation {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'boolean', default: true })
  singleton: boolean;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  @Generated('uuid')
  installationId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
