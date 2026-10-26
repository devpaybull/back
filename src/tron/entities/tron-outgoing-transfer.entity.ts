import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OutgoingTransferKind } from '../types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';

@Entity('tron_outgoing_transfers')
export class TronOutgoingTransfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ type: 'enum', enum: OutgoingTransferKind })
  kind: OutgoingTransferKind;

  @Column({ type: 'varchar', length: 34 })
  fromAddress: string;

  @Column({ type: 'varchar', length: 34 })
  toAddress: string;

  @Column({ type: 'bigint' })
  amountSun: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  txHash: string | null;

  @Index()
  @Column({ type: 'enum', enum: OutgoingTransferStatus })
  status: OutgoingTransferStatus;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'bigint', nullable: true })
  feeLimitSun: string | null;

  @Column({ type: 'bigint', nullable: true })
  energyUsed: string | null;

  @Column({ type: 'bigint', nullable: true })
  energyFromStake: string | null;

  @Column({ type: 'bigint', nullable: true })
  trxBurnedSun: string | null;

  @Column({ type: 'bigint', nullable: true })
  bandwidthUsed: string | null;

  @Column({ type: 'bigint', nullable: true })
  blockNumber: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  broadcastAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
