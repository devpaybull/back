import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { Bank } from '../../banks/entities/bank.entity';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPaymentDto } from '../dto/payment.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const CREATED_AT = new Date('2026-11-04T10:00:00.000Z');
const EXPIRES_AT = new Date('2026-11-04T10:15:00.000Z');

const tbank = { id: 3, code: 'tbank', name: 'T-Bank' } as Bank;
const sber = { id: 4, code: 'sber', name: 'Sber' } as Bank;

const deal = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: uuidOf(50),
    kind: TransactionKind.PayIn,
    status: TransactionStatus.Active,
    method: 'sbp',
    traderUserId: uuidOf(1),
    merchantTransactionId: 'order-1',
    amountFiat: toFiat('2037'),
    requestedAmountFiat: toFiat('2000'),
    amountCrypto: toCrypto('22.9'),
    rate: toRate('88.92'),
    merchantCommission: toCrypto('2.29'),
    merchantAmount: toCrypto('20.61'),
    payerInfo: { userId: 'client-7', ip: '203.0.113.5' },
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    resolvedAt: null,
    ...overrides,
  }) as Transaction;

const requisite = {
  id: uuidOf(30),
  type: BankDetailsType.CardOrSbp,
  card: null,
  phone: '79001234567',
  cardholderName: 'IVAN IVANOV',
  bank: tbank,
} as unknown as BankDetails;

describe('toPaymentDto', () => {
  it('renders a pay-in with every amount as a formatted string', () => {
    expect(
      toPaymentDto(deal(), {
        requisite,
        requestedBank: tbank,
        paymentPageUrl: 'https://pay.example/abc',
      }),
    ).toEqual({
      id: uuidOf(50),
      merchantTransactionId: 'order-1',
      type: 'pay_in',
      method: 'sbp',
      status: 'active',
      amount: '2037.00',
      requestedAmount: '2000.00',
      currency: 'RUB',
      rate: '88.920000',
      crypto: '22.900000',
      fee: '2.290000',
      merchantAmount: '20.610000',
      requisite: {
        bank: { code: 'tbank', name: 'T-Bank' },
        type: 'card_or_sbp',
        cardNumber: null,
        sbpNumber: '79001234567',
        ownerName: 'IVAN IVANOV',
      },
      bank: 'tbank',
      payerInfo: { userId: 'client-7', ip: '203.0.113.5' },
      paymentLifetime: 15,
      expiresAt: EXPIRES_AT,
      paymentPageUrl: 'https://pay.example/abc',
      dispute: null,
      createdAt: CREATED_AT,
      resolvedAt: null,
    });
  });

  it('renders a pay-out with the recipient as the requisite, whatever was issued', () => {
    const dto = toPaymentDto(
      deal({
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Pending,
        method: 'card',
        traderUserId: null,
        payoutOwnerName: 'PETR PETROV',
        payoutCardNumber: '4111111111111111',
        payoutPhone: null,
      }),
      { requisite, payoutBank: sber },
    );

    expect(dto.type).toBe('pay_out');
    expect(dto.requisite).toEqual({
      bank: { code: 'sber', name: 'Sber' },
      type: 'card_or_sbp',
      cardNumber: '4111111111111111',
      sbpNumber: null,
      ownerName: 'PETR PETROV',
    });
  });

  it('renders a pay-out to a phone as a card-or-sbp requisite with the phone', () => {
    const dto = toPaymentDto(
      deal({
        kind: TransactionKind.PayOut,
        payoutOwnerName: 'PETR PETROV',
        payoutPhone: '79007654321',
      }),
    );

    expect(dto.requisite).toEqual(
      expect.objectContaining({
        type: 'card_or_sbp',
        cardNumber: null,
        sbpNumber: '79007654321',
      }),
    );
  });

  it('answers null for every part the deal or the caller does not have', () => {
    const dto = toPaymentDto(
      deal({
        merchantTransactionId: null,
        method: null,
        amountFiat: null,
        requestedAmountFiat: null,
        rate: null,
        merchantCommission: null,
        merchantAmount: null,
        payerInfo: null,
        expiresAt: null,
      }),
    );

    expect(dto).toEqual(
      expect.objectContaining({
        merchantTransactionId: null,
        method: null,
        currency: null,
        amount: null,
        requestedAmount: null,
        rate: null,
        fee: null,
        merchantAmount: null,
        requisite: null,
        bank: null,
        payerInfo: null,
        paymentLifetime: null,
        expiresAt: null,
        paymentPageUrl: null,
        dispute: null,
      }),
    );
  });
});
