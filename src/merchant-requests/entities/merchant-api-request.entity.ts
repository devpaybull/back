import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Bank } from '../../banks/entities/bank.entity';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { Fiat } from '../../common/types/fiat';
import { fiatColumn } from '../../common/utils/fiat-column';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantApiKey } from '../../merchants/entities/merchant-api-key.entity';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { SelectionSummary } from '../../transactions/types/selection-summary';
import { User } from '../../users/entities/user.entity';
import { MerchantRequestOperation } from '../types/merchant-request-operation.enum';
import { MerchantRequestResult } from '../types/merchant-request-result.enum';

@Entity('merchant_api_requests')
@Index(['receivedAt', 'id'])
@Index(['merchantId', 'receivedAt'])
@Index(['counterpartyId', 'receivedAt'])
export class MerchantApiRequest {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @ManyToOne(() => Merchant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Column({ type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => MerchantApiKey, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'apiKeyId' })
  apiKey: MerchantApiKey;

  @Column({ type: 'int' })
  apiKeyId: number;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'text' })
  path: string;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Column({ type: 'jsonb' })
  requestHeaders: Record<string, string>;

  @Column({ type: 'text', nullable: true })
  requestBody: string | null;

  @Column({ default: false })
  requestBodyTruncated: boolean;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'text', nullable: true })
  responseBody: string | null;

  @Column({ default: false })
  responseBodyTruncated: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'int' })
  durationMs: number;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  result: MerchantRequestResult;

  @Column({ type: 'varchar', length: 32, nullable: true })
  operation: MerchantRequestOperation | null;

  @Column({ type: 'enum', enum: TransactionKind, nullable: true })
  direction: TransactionKind | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  paymentMethod: string | null;

  @Column(fiatColumn({ nullable: true }))
  amountFiat: Fiat | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requestedBankId' })
  requestedBank: Bank | null;

  @Column({ type: 'int', nullable: true })
  requestedBankId: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  payerUserId: string | null;

  @ManyToOne(() => Counterparty, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'counterpartyId' })
  counterparty: Counterparty | null;

  @Column({ type: 'int', nullable: true })
  counterpartyId: number | null;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  merchantTransactionId: string | null;

  @ManyToOne(() => Transaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transactionId' })
  transaction: Transaction | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'processedByUserId' })
  processedBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  processedByUserId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  selectionSummary: SelectionSummary | null;

  @Column({ default: false })
  counted: boolean;

  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
