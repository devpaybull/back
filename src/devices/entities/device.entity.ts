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
import { DeviceModel } from '../types/device-model.enum';
import { DeviceStatus } from '../types/device-status.enum';

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

  @Column({ type: 'enum', enum: DeviceModel, nullable: true })
  model: DeviceModel;

  @Column({ nullable: true })
  type: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastActivity: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date;
}
