import { ApiProperty } from '@nestjs/swagger';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { formatRate } from '../../common/utils/format-rate';
import { Bank } from '../../banks/entities/bank.entity';
import { Transaction } from '../entities/transaction.entity';
import { PayerInfo } from '../types/payer-info';
import { PaymentExtras } from '../types/payment-extras';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { findTransactionMethod } from '../utils/find-transaction-method';
import { PaymentBankDto } from './payment-bank.dto';
import { PaymentRequisiteDto } from './payment-requisite.dto';

const MS_PER_MINUTE = 60_000;

export class PaymentDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  merchantTransactionId: string | null;

  @ApiProperty({ enum: TransactionKind })
  type: TransactionKind;

  @ApiProperty({
    nullable: true,
    description: 'A method code from the registry',
  })
  method: string | null;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2037.00',
    description: 'The amount the client pays',
  })
  amount: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2000.00',
    description: 'The amount the merchant asked for, before randomisation',
  })
  requestedAmount: string | null;

  @ApiProperty({ nullable: true, example: 'RUB' })
  currency: string | null;

  @ApiProperty({ type: String, nullable: true, example: '88.920000' })
  rate: string | null;

  @ApiProperty({ type: String, example: '22.491003' })
  crypto: string;

  @ApiProperty({ type: String, nullable: true, example: '2.249100' })
  fee: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '20.241903',
    description: 'What is credited to or debited from the merchant balance',
  })
  merchantAmount: string | null;

  @ApiProperty({
    type: PaymentRequisiteDto,
    nullable: true,
    description:
      'Pay-in: the requisite issued to the client; pay-out: the recipient',
  })
  requisite: PaymentRequisiteDto | null;

  @ApiProperty({
    nullable: true,
    description: 'The bank code the merchant asked for',
  })
  bank: string | null;

  @ApiProperty({ type: Object, nullable: true })
  payerInfo: PayerInfo | null;

  @ApiProperty({ nullable: true, description: 'Minutes' })
  paymentLifetime: number | null;

  @ApiProperty({ nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ nullable: true })
  paymentPageUrl: string | null;

  @ApiProperty({ type: Object, nullable: true })
  dispute: null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  resolvedAt: Date | null;
}

const toPaymentBankDto = (
  bank: Bank | null | undefined,
): PaymentBankDto | null =>
  bank ? { code: bank.code ?? null, name: bank.name } : null;

const toRequisite = (
  deal: Transaction,
  extras: PaymentExtras,
): PaymentRequisiteDto | null => {
  if (deal.kind === TransactionKind.PayOut) {
    if (!deal.payoutCardNumber && !deal.payoutPhone) return null;

    return {
      bank: toPaymentBankDto(extras.payoutBank),
      type: BankDetailsType.CardOrSbp,
      cardNumber: deal.payoutCardNumber ?? null,
      sbpNumber: deal.payoutPhone ?? null,
      ownerName: deal.payoutOwnerName ?? null,
    };
  }

  const issued = extras.requisite;

  return issued
    ? {
        bank: toPaymentBankDto(issued.bank),
        type: issued.type,
        cardNumber: issued.card ?? null,
        sbpNumber: issued.phone ?? null,
        ownerName: issued.cardholderName ?? null,
      }
    : null;
};

export const toPaymentDto = (
  deal: Transaction,
  extras: PaymentExtras = {},
): PaymentDto => ({
  id: deal.id,
  merchantTransactionId: deal.merchantTransactionId ?? null,
  type: deal.kind,
  method: deal.method ?? null,
  status: deal.status,
  amount: formatFiat(deal.amountFiat),
  requestedAmount: formatFiat(deal.requestedAmountFiat),
  currency: deal.method
    ? (findTransactionMethod(deal.method)?.currency ?? null)
    : null,
  rate: formatRate(deal.rate),
  crypto: formatCrypto(deal.amountCrypto),
  fee: formatCrypto(deal.merchantCommission),
  merchantAmount: formatCrypto(deal.merchantAmount),
  requisite: toRequisite(deal, extras),
  bank: extras.requestedBank?.code ?? null,
  payerInfo: deal.payerInfo ?? null,
  paymentLifetime: deal.expiresAt
    ? Math.round(
        (deal.expiresAt.getTime() - deal.createdAt.getTime()) / MS_PER_MINUTE,
      )
    : null,
  expiresAt: deal.expiresAt ?? null,
  paymentPageUrl: extras.paymentPageUrl ?? null,
  dispute: null,
  createdAt: deal.createdAt,
  resolvedAt: deal.resolvedAt ?? null,
});
