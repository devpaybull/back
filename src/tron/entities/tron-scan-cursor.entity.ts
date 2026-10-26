import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tron_scan_cursor')
export class TronScanCursor {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'boolean', default: true })
  singleton: boolean;

  @Column({ type: 'varchar', length: 16 })
  network: string;

  @Column({ type: 'bigint' })
  lastBlock: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
