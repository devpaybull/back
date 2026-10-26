import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Crypto } from '../../common/types/crypto';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { AddressPurpose } from '../types/address-purpose.enum';

@Entity('tron_addresses')
export class TronAddress {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 34 })
  address: string;

  @Index({ unique: true })
  @Column({ type: 'int', nullable: true })
  derivationIndex: number | null;

  @Index()
  @Column({ type: 'enum', enum: AddressPurpose })
  purpose: AddressPurpose;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column(cryptoColumn({ default: '0' }))
  unsweptAmount: Crypto;

  @Column({ type: 'timestamptz', nullable: true })
  lastIncomingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSweptAt: Date | null;

  @Column({ type: 'int', default: 0 })
  sweepNonce: number;

  @Column({ type: 'bigint', nullable: true })
  sweepDelegatedSun: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
