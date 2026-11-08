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
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { Device } from '../../devices/entities/device.entity';
import { BankMessageTemplate } from '../../message-templates/entities/bank-message-template.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { User } from '../../users/entities/user.entity';
import { DeviceMessageKind } from '../types/device-message-kind.enum';
import { DeviceMessageMatchStatus } from '../types/device-message-match-status.enum';
import { DeviceMessageType } from '../types/device-message-type.enum';

@Entity('device_messages')
@Index(['deviceId', 'externalId'], { unique: true })
export class DeviceMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Device, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Column({ type: 'int' })
  deviceId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 200 })
  externalId: string;

  @Column({ type: 'enum', enum: DeviceMessageKind })
  kind: DeviceMessageKind;

  @Column({ type: 'varchar', length: 100 })
  sender: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @Column()
  senderKnown: boolean;

  @Column({ type: 'enum', enum: DeviceMessageType })
  messageType: DeviceMessageType;

  @ManyToOne(() => BankMessageTemplate, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'templateId' })
  template: BankMessageTemplate | null;

  @Column({ type: 'int', nullable: true })
  templateId: number | null;

  @Column(fiatColumn({ nullable: true }))
  parsedAmount: Fiat | null;

  @Column({ type: 'enum', enum: DeviceMessageMatchStatus })
  matchStatus: DeviceMessageMatchStatus;

  @ManyToOne(() => Transaction, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
