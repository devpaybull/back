import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { DeviceStatus } from '../types/device-status.enum';
import { DeviceType } from '../types/device-type.enum';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  @Generated('uuid')
  key: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: DeviceStatus, default: DeviceStatus.Off })
  status: DeviceStatus;

  @Column({ type: 'enum', enum: DeviceType, default: DeviceType.Android })
  type: DeviceType;

  @Column({ nullable: true })
  model: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastActivity: Date;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt: Date;

  @Column({ nullable: true })
  appVersion: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date;
}
