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
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { User } from '../../users/entities/user.entity';
import { RequisiteEventKind } from '../types/requisite-event-kind.enum';
import { RequisiteEventReason } from '../types/requisite-event-reason.enum';
import { RequisiteEventSource } from '../types/requisite-event-source.enum';
import { Counterparty } from './counterparty.entity';

@Entity('counterparty_requisite_events')
export class CounterpartyRequisiteEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Counterparty, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counterpartyId' })
  counterparty: Counterparty;

  @Index()
  @Column({ type: 'int' })
  counterpartyId: number;

  @ManyToOne(() => BankDetails, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankDetailsId' })
  bankDetails: BankDetails;

  @Column({ type: 'uuid' })
  bankDetailsId: string;

  @Column({ type: 'enum', enum: RequisiteEventKind })
  kind: RequisiteEventKind;

  @Column({ type: 'enum', enum: RequisiteEventSource })
  source: RequisiteEventSource;

  @Column({ type: 'enum', enum: RequisiteEventReason, nullable: true })
  reason: RequisiteEventReason | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actorUserId' })
  actor: User;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
