import {
  Check,
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
import { Bank } from '../../banks/entities/bank.entity';
import { Fiat } from '../../common/types/fiat';
import { Rate } from '../../common/types/rate';
import { fiatColumn } from '../../common/utils/fiat-column';
import { rateColumn } from '../../common/utils/rate-column';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { MobileOperator } from '../../mobile-operators/entities/mobile-operator.entity';
import { User } from '../../users/entities/user.entity';
import { PayerInfo } from '../types/payer-info';
import { PayInDeclineReason } from '../types/pay-in-decline-reason.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionMethod } from '../types/transaction-method';
import { TransactionStatus } from '../types/transaction-status.enum';
import { cryptoColumn } from '../../common/utils/crypto-column';
import { Crypto } from '../../common/types/crypto';
import { percentColumn } from '../../common/utils/percent-column';

@Entity('transactions')
@Index(['merchantId', 'merchantTransactionId'], { unique: true })
@Check(
  'transactions_trader_unset_only_on_untaken_pay_out',
  `"traderUserId" IS NOT NULL OR ("kind" = 'pay_out' AND "status" IN ('pending', 'canceled'))`,
)
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TransactionKind })
  kind: TransactionKind;

  @Index()
  @Column({ type: 'enum', enum: TransactionStatus })
  status: TransactionStatus;

  @Column({ type: 'varchar', nullable: true })
  method: TransactionMethod;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'traderUserId' })
  trader: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  traderUserId: string | null;

  @ManyToOne(() => BankDetails, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bankDetailsId' })
  bankDetails: BankDetails;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  bankDetailsId: string;

  @ManyToOne(() => Counterparty, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counterpartyId' })
  counterparty: Counterparty;

  @Index()
  @Column({ type: 'int', nullable: true })
  counterpartyId: number;

  @ManyToOne(() => Merchant, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'merchantId' })
  merchant: Merchant;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  merchantId: string;

  @Column(fiatColumn({ nullable: true }))
  amountFiat: Fiat;

  @Column(cryptoColumn())
  amountCrypto: Crypto;

  @Column(rateColumn({ nullable: true }))
  rate: Rate;

  @Column(percentColumn({ nullable: true }))
  merchantPercent: number;

  @Column(percentColumn({ nullable: true }))
  traderPercent: number;

  @Column(percentColumn({ nullable: true }))
  traderEffectivePercent: number;

  @Column(percentColumn({ nullable: true }))
  leadPercent: number;

  @Column(cryptoColumn({ nullable: true }))
  merchantCommission: Crypto;

  @Column(cryptoColumn({ nullable: true }))
  traderCommission: Crypto;

  @Column(cryptoColumn({ nullable: true }))
  leadCommission: Crypto;

  @Column(cryptoColumn({ nullable: true }))
  traderAmount: Crypto;

  @Column(cryptoColumn({ nullable: true }))
  merchantAmount: Crypto;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  merchantTransactionId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payerInfo: PayerInfo | null;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requestedBankId' })
  requestedBank: Bank | null;

  @Column({ type: 'int', nullable: true })
  requestedBankId: number | null;

  @ManyToOne(() => MobileOperator, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requestedOperatorId' })
  requestedOperator: MobileOperator | null;

  @Column({ type: 'int', nullable: true })
  requestedOperatorId: number | null;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payerBankId' })
  payerBank: Bank | null;

  @Column({ type: 'int', nullable: true })
  payerBankId: number | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  callbackUrl: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  successUrl: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  errorUrl: string | null;

  @Column(fiatColumn({ nullable: true }))
  requestedAmountFiat: Fiat | null;

  @Column({ type: 'timestamptz', nullable: true })
  timerExtendedAt: Date | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  paymentPageToken: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  payoutOwnerName: string | null;

  @ManyToOne(() => Bank, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'payoutBankId' })
  payoutBank: Bank | null;

  @Column({ type: 'int', nullable: true })
  payoutBankId: number | null;

  @Column({ type: 'varchar', length: 19, nullable: true })
  payoutCardNumber: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  payoutPhone: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  payoutTakenAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  payoutDeadlineAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  payoutCompletedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  payoutAssignedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  declineReasonCode: PayInDeclineReason | null;

  @Column({ type: 'text', nullable: true })
  declineComment: string | null;

  @Column(fiatColumn({ nullable: true }))
  originalAmountFiat: Fiat | null;

  @Column(cryptoColumn({ nullable: true }))
  originalAmountCrypto: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  originalMerchantCommission: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  originalTraderCommission: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  originalLeadCommission: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  originalTraderAmount: Crypto | null;

  @Column(cryptoColumn({ nullable: true }))
  originalMerchantAmount: Crypto | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
