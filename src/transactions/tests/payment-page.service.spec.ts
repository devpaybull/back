import { ConflictException, NotFoundException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TransactionFile } from '../entities/transaction-file.entity';
import { Transaction } from '../entities/transaction.entity';
import { PaymentPageService } from '../services/payment-page.service';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionFileKind } from '../types/transaction-file-kind.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const TOKEN = 'a'.repeat(43);
const DEAL = uuidOf(7);
const MERCHANT = uuidOf(8);
const NOW = new Date('2026-11-07T10:00:00Z');
const STORED = {
  storageKey: `deals/${DEAL}/x`,
  mime: 'application/pdf',
  size: 4,
  name: 'check.pdf',
};

const dealOf = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: DEAL,
    kind: TransactionKind.PayIn,
    status: TransactionStatus.Active,
    merchantId: MERCHANT,
    paymentPageToken: TOKEN,
    payerPaidAt: null,
    expiresAt: new Date(NOW.getTime() + 600_000),
    successUrl: null,
    errorUrl: null,
    ...overrides,
  }) as Transaction;

describe('PaymentPageService', () => {
  const build = (
    deal: Transaction | null,
    options: { receipts?: number[] } = {},
  ) => {
    const receipts = [...(options.receipts ?? [0])];
    const manager = {
      findOne: jest.fn(async () => deal),
      count: jest.fn(async () => receipts.shift() ?? 0),
    };
    const dataSource = {
      manager,
      transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
        work(manager),
      ),
    };
    const transactions = {
      transitionLocked: jest.fn(
        async (_m: unknown, row: Transaction, change: { toStatus: string }) =>
          Object.assign(row, { status: change.toStatus }),
      ),
    };
    const payments = {
      paymentsOf: jest.fn(async (_m: unknown, rows: Transaction[]) =>
        rows.map((row) => ({
          id: row.id,
          amount: '2000.00',
          currency: 'RUB',
          requisite: {
            bank: { code: 'tbank', name: 'Т-банк' },
            type: 'card_or_sbp',
            cardNumber: null,
            sbpNumber: '79010000001',
            ownerName: 'IVAN IVANOV',
          },
          expiresAt: row.expiresAt,
          status: row.status,
          merchantTransactionId: 'order-1',
          crypto: '22.000000',
        })),
      ),
    };
    const files = {
      store: jest.fn(async () => STORED),
      discard: jest.fn(async () => undefined),
      recordWithin: jest.fn(
        async () =>
          ({ id: uuidOf(9), ...STORED }) as unknown as TransactionFile,
      ),
    };
    const settings = {
      settingsOf: jest.fn(async () => ({
        successUrl: 'https://merchant.example/ok',
        errorUrl: 'https://merchant.example/err',
        supportLink: 'https://t.me/support',
      })),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new PaymentPageService(
      dataSource as never,
      transactions as never,
      payments as never,
      files as never,
      settings as never,
      audit as never,
      { getOrThrow: () => 24 } as never,
    );

    return { service, manager, transactions, files, audit, settings };
  };

  describe('view', () => {
    it('answers only what the payer needs, the merchant’s URLs as the fallback', async () => {
      const { service, manager } = build(dealOf());

      await expect(service.view(TOKEN)).resolves.toEqual({
        amount: '2000.00',
        currency: 'RUB',
        requisite: {
          bank: { code: 'tbank', name: 'Т-банк' },
          type: 'card_or_sbp',
          cardNumber: null,
          sbpNumber: '79010000001',
          ownerName: 'IVAN IVANOV',
        },
        expiresAt: new Date(NOW.getTime() + 600_000),
        status: TransactionStatus.Active,
        successUrl: 'https://merchant.example/ok',
        errorUrl: 'https://merchant.example/err',
        supportLink: 'https://t.me/support',
      });
      expect(manager.findOne).toHaveBeenCalledWith(Transaction, {
        where: { paymentPageToken: TOKEN, kind: TransactionKind.PayIn },
      });
    });

    it('prefers the deal’s own URLs', async () => {
      const { service } = build(
        dealOf({
          successUrl: 'https://deal.example/ok',
          errorUrl: 'https://deal.example/err',
        }),
      );

      await expect(service.view(TOKEN)).resolves.toMatchObject({
        successUrl: 'https://deal.example/ok',
        errorUrl: 'https://deal.example/err',
      });
    });

    it.each([
      ['an unknown token', null, TOKEN],
      ['a malformed token', dealOf(), 'short'],
      [
        'a deal resolved 24 hours ago',
        dealOf({
          status: TransactionStatus.Success,
          resolvedAt: new Date(NOW.getTime() - 24 * 3_600_000),
        }),
        TOKEN,
      ],
      [
        'a final deal with no resolvedAt',
        dealOf({ status: TransactionStatus.Canceled, resolvedAt: null }),
        TOKEN,
      ],
    ])('is a 404 PAYMENT_PAGE_NOT_FOUND for %s', async (_case, deal, token) => {
      const { service, manager } = build(deal);
      const error = await service
        .view(token)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'PAYMENT_PAGE_NOT_FOUND',
      });
      if (token === 'short') expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('shows a final deal for 24 hours after it was resolved: the amount, the status and the merchant’s URLs, no requisite and no timer', async () => {
      for (const status of [
        TransactionStatus.Success,
        TransactionStatus.SuccessChanged,
        TransactionStatus.Canceled,
      ]) {
        const { service } = build(
          dealOf({
            status,
            resolvedAt: new Date(NOW.getTime() - 24 * 3_600_000 + 1),
          }),
        );

        await expect(service.view(TOKEN, NOW)).resolves.toEqual({
          amount: '2000.00',
          currency: 'RUB',
          requisite: null,
          expiresAt: null,
          status,
          successUrl: 'https://merchant.example/ok',
          errorUrl: 'https://merchant.example/err',
          supportLink: 'https://t.me/support',
        });
      }
    });

    it('still serves a deal in checking, checking_manually or a dispute', async () => {
      for (const status of [
        TransactionStatus.Checking,
        TransactionStatus.CheckingManually,
        TransactionStatus.Dispute,
        TransactionStatus.ManualReview,
      ]) {
        const { service } = build(dealOf({ status }));

        await expect(service.view(TOKEN)).resolves.toMatchObject({ status });
      }
    });
  });

  describe('markPaid', () => {
    it('moves an active pay-in to checking under the lock, as the payer, once, with an audit row', async () => {
      const deal = dealOf();
      const { service, manager, transactions, audit } = build(deal);

      await expect(service.markPaid(TOKEN, NOW)).resolves.toMatchObject({
        status: TransactionStatus.Checking,
      });
      expect(manager.findOne).toHaveBeenCalledWith(Transaction, {
        where: { paymentPageToken: TOKEN, kind: TransactionKind.PayIn },
        lock: { mode: 'pessimistic_write' },
      });
      expect(transactions.transitionLocked).toHaveBeenCalledWith(
        manager,
        deal,
        {
          toStatus: TransactionStatus.Checking,
          source: StatusEventSource.Payer,
          actorUserId: null,
        },
      );
      expect(deal.payerPaidAt).toEqual(NOW);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: null,
          action: 'payment_page.paid',
          metadata: { merchantId: MERCHANT, transactionId: DEAL },
        },
        manager,
      );
    });

    it('answers a repeat as it is and moves nothing', async () => {
      const { service, transactions, audit } = build(
        dealOf({
          status: TransactionStatus.Checking,
          payerPaidAt: new Date(NOW.getTime() - 1000),
        }),
      );

      await expect(service.markPaid(TOKEN, NOW)).resolves.toMatchObject({
        status: TransactionStatus.Checking,
      });
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses a second «paid» after the deal came back to active', async () => {
      const { service, transactions } = build(
        dealOf({ payerPaidAt: new Date(NOW.getTime() - 1000) }),
      );

      await service.markPaid(TOKEN, NOW);
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it.each([
      [
        'checking by another path',
        dealOf({ status: TransactionStatus.Checking }),
      ],
      [
        'checking_manually',
        dealOf({ status: TransactionStatus.CheckingManually }),
      ],
      ['past its timer', dealOf({ expiresAt: NOW })],
    ])('is a 409 PAYMENT_NOT_PAYABLE in %s', async (_case, deal) => {
      const { service, transactions } = build(deal);
      const error = await service
        .markPaid(TOKEN, NOW)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'PAYMENT_NOT_PAYABLE',
      });
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it('is a 404 on a final deal, even one the page still shows', async () => {
      const { service } = build(
        dealOf({ status: TransactionStatus.Success, resolvedAt: NOW }),
      );

      await expect(service.markPaid(TOKEN, NOW)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('uploadReceipt', () => {
    const upload = { buffer: Buffer.from('%PDF'), name: 'check.pdf' };

    it('stores a payer receipt with no uploader and audits it, the status untouched', async () => {
      const { service, manager, files, audit, transactions } = build(dealOf());

      await expect(service.uploadReceipt(TOKEN, upload)).resolves.toEqual({
        name: 'check.pdf',
        size: 4,
        mime: 'application/pdf',
      });
      expect(files.store).toHaveBeenCalledWith(DEAL, upload);
      expect(files.recordWithin).toHaveBeenCalledWith(
        manager,
        DEAL,
        TransactionFileKind.PayerReceipt,
        STORED,
        null,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: null,
          action: 'payment_page.receipt_uploaded',
        }),
        manager,
      );
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
      expect(files.discard).not.toHaveBeenCalled();
    });

    it('refuses the fourth receipt before storing anything', async () => {
      const { service, files } = build(dealOf(), { receipts: [3] });
      const error = await service
        .uploadReceipt(TOKEN, upload)
        .catch((caught: unknown) => caught);

      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'RECEIPT_LIMIT_REACHED',
      });
      expect(files.store).not.toHaveBeenCalled();
    });

    it('counts again under the lock and deletes the stored object when a parallel upload won', async () => {
      const { service, files } = build(dealOf(), { receipts: [2, 3] });

      await expect(service.uploadReceipt(TOKEN, upload)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(files.recordWithin).not.toHaveBeenCalled();
      expect(files.discard).toHaveBeenCalledWith(STORED);
    });

    it('is a 404 on a final deal, even one the page still shows, and stores nothing', async () => {
      const { service, files } = build(
        dealOf({ status: TransactionStatus.Canceled, resolvedAt: NOW }),
      );

      await expect(service.uploadReceipt(TOKEN, upload)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(files.store).not.toHaveBeenCalled();
    });
  });

  describe('assertAcceptsReceipt', () => {
    it('passes a live deal with room for a receipt', async () => {
      const { service } = build(dealOf(), { receipts: [2] });

      await expect(
        service.assertAcceptsReceipt(TOKEN),
      ).resolves.toBeUndefined();
    });

    it('is the page’s 404 for a malformed, unknown or final token', async () => {
      for (const [deal, token] of [
        [dealOf(), 'x'],
        [null, TOKEN],
        [dealOf({ status: TransactionStatus.Success, resolvedAt: NOW }), TOKEN],
      ] as const) {
        const { service } = build(deal);
        const error = await service
          .assertAcceptsReceipt(token)
          .catch((caught: unknown) => caught);

        expect((error as NotFoundException).getResponse()).toMatchObject({
          code: 'PAYMENT_PAGE_NOT_FOUND',
        });
      }
    });

    it('is 409 RECEIPT_LIMIT_REACHED with three receipts already there', async () => {
      const { service } = build(dealOf(), { receipts: [3] });
      const error = await service
        .assertAcceptsReceipt(TOKEN)
        .catch((caught: unknown) => caught);

      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'RECEIPT_LIMIT_REACHED',
      });
    });
  });
});
