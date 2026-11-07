import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { MerchantRequestDetails } from '../../merchant-requests/types/merchant-request-details';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { NoRequisiteFoundError } from '../../transactions/exceptions/no-requisite-found.exception';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { NoBaseRateError } from '../../transactions/utils/resolve-rate';
import { PaymentViewService } from '../../transactions/services/payment-view.service';
import { MerchantApiService } from '../merchant-api.service';
import { PayInRequest } from '../types/pay-in-request';
import { PayOutRequest } from '../types/pay-out-request';

const MERCHANT = uuidOf(1);
const TRADER = uuidOf(2);
const DEAL = uuidOf(3);
const REQUISITE = uuidOf(4);
const REQUEST_ID = uuidOf(5);
const SUMMARY = {
  considered: 1,
  dropped: {},
  attempted: 1,
  skippedUnderLock: {},
  issuedBankDetailsId: REQUISITE,
};

const request = (overrides: Partial<PayInRequest> = {}): PayInRequest => ({
  method: 'sbp',
  amount: toFiat(2000),
  merchantTransactionId: 'order-1',
  payerInfo: { userId: 'client-1' },
  ...overrides,
});

const deal = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: DEAL,
    kind: TransactionKind.PayIn,
    status: TransactionStatus.Active,
    method: 'sbp',
    traderUserId: TRADER,
    bankDetailsId: REQUISITE,
    merchantTransactionId: 'order-1',
    amountFiat: toFiat(2000),
    requestedAmountFiat: toFiat(2000),
    requestedBankId: null,
    amountCrypto: toCrypto(22),
    rate: toRate(90.9),
    merchantCommission: toCrypto(2),
    merchantAmount: toCrypto(20),
    payerInfo: { userId: 'client-1' },
    createdAt: new Date('2026-11-04T10:00:00Z'),
    expiresAt: new Date('2026-11-04T10:15:00Z'),
    resolvedAt: null,
    ...overrides,
  }) as Transaction;

const payOutRequest = (
  overrides: Partial<PayOutRequest> = {},
): PayOutRequest => ({
  method: 'card',
  amount: toFiat(5000),
  merchantTransactionId: 'payout-1',
  requisite: {
    ownerName: 'PETR PETROV',
    bank: 'tbank',
    cardNumber: '4111111111111111',
  },
  ...overrides,
});

const payOutDeal = (overrides: Partial<Transaction> = {}): Transaction =>
  deal({
    kind: TransactionKind.PayOut,
    status: TransactionStatus.Pending,
    method: 'card',
    traderUserId: null,
    bankDetailsId: null as never,
    merchantTransactionId: 'payout-1',
    amountFiat: toFiat(5000),
    requestedAmountFiat: null,
    payoutOwnerName: 'PETR PETROV',
    payoutBankId: 7,
    payoutCardNumber: '4111111111111111',
    payoutPhone: null,
    ...overrides,
  });

const build = () => {
  const deps = {
    methods: {
      statesByMerchant: jest.fn(async () => {
        return new Map([
          [
            MERCHANT,
            [
              { method: 'sbp', payInEnabled: true, payOutEnabled: false },
              { method: 'card', payInEnabled: false, payOutEnabled: false },
              {
                method: 'counterparty',
                payInEnabled: true,
                payOutEnabled: false,
              },
            ],
          ],
        ]);
      }),
    },
    settings: {
      settingsOf: jest.fn(async () => ({
        minPayInAmount: null as ReturnType<typeof toFiat> | null,
        randomizationWindow: 0,
        sameRequestsEnabled: false,
        failedDealsLimitEnabled: false,
        failedDealsPerHour: 5,
      })),
    },
    currencies: {
      currenciesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              [{ currency: { isocode: 'RUB' }, payInMarkupPercent: 2 }],
            ],
          ]),
      ),
    },
    banks: {
      findActiveByCode: jest.fn(async (code: string) =>
        code === 'tbank' ? { id: 7, code: 'tbank', name: 'Т-банк' } : null,
      ),
      findByIds: jest.fn(async () => []),
    },
    operators: {
      findActiveByCode: jest.fn(async (code: string) =>
        code === 'mts' ? { id: 3 } : null,
      ),
    },
    bankDetails: {
      counterpartyMinAmount: toFiat(5000),
      findByIdsWithDeleted: jest.fn(async () => [
        {
          id: REQUISITE,
          type: 'card_or_sbp',
          card: null,
          phone: '+79010000001',
          cardholderName: 'IVAN',
          bank: { code: 'tbank', name: 'Т-банк' },
        },
      ]),
    },
    counterparties: {
      findOrCreate: jest.fn(async () => ({
        id: 11,
        enabled: true,
        blacklistedAt: null as Date | null,
      })),
    },
    transactions: {
      findByMerchantTransactionId: jest.fn(
        async (): Promise<Transaction | null> => null,
      ),
      countFailedPayInsSince: jest.fn(async () => 0),
      findActiveSameRequest: jest.fn(
        async (): Promise<Transaction | null> => null,
      ),
      cancelByMerchant: jest.fn(async (): Promise<Transaction> => deal()),
      extendTimerByMerchant: jest.fn(async (): Promise<Transaction> => deal()),
      createPayOutRequest: jest.fn(async (): Promise<Transaction> =>
        payOutDeal(),
      ),
    },
    deals: {
      findOwn: jest.fn(async (): Promise<Transaction> => deal()),
      list: jest.fn(),
    },
    rates: {
      merchantSourceRate: jest.fn(async () => toRate(92.7)),
      resolveMethodPercent: jest.fn(async () => 10),
    },
    selection: {
      issue: jest.fn(async () => ({
        transaction: deal(),
        viaBinding: false,
        boundNow: false,
        summary: SUMMARY,
      })),
    },
  };
  const service = new MerchantApiService(
    deps.methods as never,
    deps.settings as never,
    deps.currencies as never,
    deps.banks as never,
    deps.operators as never,
    deps.bankDetails as never,
    deps.counterparties as never,
    deps.transactions as never,
    deps.deals as never,
    deps.rates as never,
    deps.selection as never,
    { openByMerchant: jest.fn(), cancelByMerchant: jest.fn() } as never,
    new PaymentViewService(deps.bankDetails as never, deps.banks as never),
    { manager: { find: jest.fn(async () => []) } } as never,
  );
  const log: MerchantRequestDetails = {};
  const create = (input: PayInRequest = request()) =>
    service.createPayIn(MERCHANT, REQUEST_ID, input, log);

  return { deps, log, create, service };
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const body = (error as HttpException).getResponse() as {
      code: string;
      details?: unknown;
    };

    return {
      status: (error as HttpException).getStatus(),
      code: body.code,
      details: body.details,
    };
  }
  throw new Error('expected a refusal');
};

describe('MerchantApiService.createPayIn', () => {
  it('issues a requisite: 201 with the deal, the request id handed to selection, the log filled in', async () => {
    const { deps, log, create } = build();

    const outcome = await create(
      request({
        bank: 'tbank',
        payerBank: 'tbank',
        callbackUrl: 'https://merchant.example/cb',
      }),
    );

    expect(outcome.created).toBe(true);
    expect(outcome.sameRequest).toBe(false);
    expect(outcome.payment).toMatchObject({
      id: DEAL,
      amount: '2000.00',
      requisite: { sbpNumber: '+79010000001', ownerName: 'IVAN' },
      bank: 'tbank',
      paymentLifetime: 15,
      paymentPageUrl: null,
    });
    expect(deps.selection.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: REQUEST_ID,
        merchantId: MERCHANT,
        method: 'sbp',
        rate: toRate(92.7),
        merchantPercent: 10,
        counterpartyId: 11,
        merchantTransactionId: 'order-1',
        requestedBankId: 7,
        payerBankId: 7,
        callbackUrl: 'https://merchant.example/cb',
        requestedAmountFiat: toFiat(2000),
      }),
    );
    expect(log).toMatchObject({
      operation: 'pay_in_create',
      direction: TransactionKind.PayIn,
      paymentMethod: 'sbp',
      currency: 'RUB',
      requestedBankId: 7,
      payerUserId: 'client-1',
      merchantTransactionId: 'order-1',
      transactionId: DEAL,
      processedByUserId: TRADER,
      selectionSummary: SUMMARY,
    });
  });

  it('prices the deal at the merchant rate with the pay-in markup of the method’s currency', async () => {
    const { deps, create } = build();

    await create();

    expect(deps.rates.merchantSourceRate).toHaveBeenCalledWith(2);
    expect(deps.rates.resolveMethodPercent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'merchant',
        subjectMerchantId: MERCHANT,
        direction: 'payIn',
        method: 'sbp',
      }),
    );
  });

  describe('the order of refusals (AC-3.2)', () => {
    it('step 3: a method not in the registry is 400 METHOD_NOT_SUPPORTED, before anything is read', async () => {
      const { deps, create } = build();

      for (const method of ['bitcoin', 'SBP']) {
        expect(await codeOf(create(request({ method })))).toMatchObject({
          status: 400,
          code: 'METHOD_NOT_SUPPORTED',
        });
      }
      expect(deps.methods.statesByMerchant).not.toHaveBeenCalled();
    });

    it('step 3: a currency other than the method’s is 400 CURRENCY_MISMATCH', async () => {
      const { create } = build();

      expect(await codeOf(create(request({ currency: 'KZT' })))).toMatchObject({
        status: 400,
        code: 'CURRENCY_MISMATCH',
      });
      await expect(create(request({ currency: 'RUB' }))).resolves.toBeDefined();
    });

    it('step 3: a method the merchant switched off is 403 METHOD_DISABLED, before the bank is looked up', async () => {
      const { deps, create } = build();

      expect(
        await codeOf(create(request({ method: 'card', bank: 'nope' }))),
      ).toMatchObject({ status: 403, code: 'METHOD_DISABLED' });
      expect(deps.banks.findActiveByCode).not.toHaveBeenCalled();
    });

    it('step 4: an unknown or inactive bank (or payer bank) is 400 BANK_NOT_FOUND, before the idempotency lookup', async () => {
      const { deps, create } = build();

      expect(await codeOf(create(request({ bank: 'nope' })))).toMatchObject({
        status: 400,
        code: 'BANK_NOT_FOUND',
      });
      expect(
        await codeOf(create(request({ payerBank: 'nope' }))),
      ).toMatchObject({ code: 'BANK_NOT_FOUND' });
      expect(
        deps.transactions.findByMerchantTransactionId,
      ).not.toHaveBeenCalled();
    });

    it('an unknown mobile operator is 400 VALIDATION_FAILED on the operator field', async () => {
      const { create } = build();

      expect(await codeOf(create(request({ operator: 'nope' })))).toMatchObject(
        {
          status: 400,
          code: 'VALIDATION_FAILED',
          details: [{ field: 'operator', code: 'notFound' }],
        },
      );
    });

    it('step 6: below the merchant minimum is 403 AMOUNT_BELOW_MINIMUM, before the counterparty is created', async () => {
      const { deps, create } = build();
      deps.settings.settingsOf.mockResolvedValue({
        ...(await deps.settings.settingsOf()),
        minPayInAmount: toFiat(2500),
      });

      expect(await codeOf(create())).toMatchObject({
        status: 403,
        code: 'AMOUNT_BELOW_MINIMUM',
      });
      expect(deps.counterparties.findOrCreate).not.toHaveBeenCalled();
    });

    it('step 6: a counterparty pay-in below COUNTERPARTY_MIN_AMOUNT is 403 AMOUNT_BELOW_MINIMUM', async () => {
      const { create } = build();

      expect(
        await codeOf(create(request({ method: 'counterparty' }))),
      ).toMatchObject({ code: 'AMOUNT_BELOW_MINIMUM' });
      await expect(
        create(request({ method: 'counterparty', amount: toFiat(5000) })),
      ).resolves.toBeDefined();
    });

    it('step 7: a disabled or blacklisted payer is 403 PAYER_BLOCKED', async () => {
      const { deps, create } = build();

      deps.counterparties.findOrCreate.mockResolvedValueOnce({
        id: 11,
        enabled: false,
        blacklistedAt: null,
      });
      expect(await codeOf(create())).toMatchObject({
        status: 403,
        code: 'PAYER_BLOCKED',
      });

      deps.counterparties.findOrCreate.mockResolvedValueOnce({
        id: 11,
        enabled: true,
        blacklistedAt: new Date(),
      });
      expect(await codeOf(create())).toMatchObject({ code: 'PAYER_BLOCKED' });
      expect(deps.counterparties.findOrCreate).toHaveBeenCalledWith(
        MERCHANT,
        'client-1',
      );
    });

    it('step 8: with the limit on, active + canceled deals of the client in the last 60 minutes at the limit are 403 FAILED_DEALS_LIMIT', async () => {
      const { deps, create } = build();
      const now = Date.now();
      deps.settings.settingsOf.mockResolvedValue({
        ...(await deps.settings.settingsOf()),
        failedDealsLimitEnabled: true,
        failedDealsPerHour: 3,
      });
      deps.transactions.countFailedPayInsSince.mockResolvedValueOnce(3);

      expect(await codeOf(create())).toMatchObject({
        status: 403,
        code: 'FAILED_DEALS_LIMIT',
      });
      const [merchantId, counterpartyId, since] = deps.transactions
        .countFailedPayInsSince.mock.calls[0] as unknown as [
        string,
        number,
        Date,
      ];
      expect([merchantId, counterpartyId]).toEqual([MERCHANT, 11]);
      expect(now - since.getTime()).toBeGreaterThanOrEqual(3_600_000 - 1000);
      expect(now - since.getTime()).toBeLessThanOrEqual(3_600_000 + 1000);

      deps.transactions.countFailedPayInsSince.mockResolvedValueOnce(2);
      await expect(create()).resolves.toBeDefined();
    });

    it('step 8: the limit switched off counts nothing', async () => {
      const { deps, create } = build();

      await create();

      expect(deps.transactions.countFailedPayInsSince).not.toHaveBeenCalled();
    });

    it('step 11: no merchant rate is 403 RATE_NOT_FOUND; Rapira down is 503 RATE_UNAVAILABLE; no selection either way', async () => {
      const { deps, create } = build();

      deps.rates.resolveMethodPercent.mockRejectedValueOnce(
        new NoBaseRateError(),
      );
      expect(await codeOf(create())).toMatchObject({
        status: 403,
        code: 'RATE_NOT_FOUND',
      });

      deps.rates.merchantSourceRate.mockRejectedValueOnce(
        new ServiceUnavailableException('down'),
      );
      expect(await codeOf(create())).toMatchObject({
        status: 503,
        code: 'RATE_UNAVAILABLE',
      });
      expect(deps.selection.issue).not.toHaveBeenCalled();
    });

    it('step 12: nothing found rethrows NoRequisiteFoundError and leaves the summary for the log', async () => {
      const { deps, log, create } = build();
      deps.selection.issue.mockRejectedValueOnce(
        new NoRequisiteFoundError(SUMMARY),
      );

      await expect(create()).rejects.toBeInstanceOf(NoRequisiteFoundError);
      expect(log.selectionSummary).toBe(SUMMARY);
      expect(log.transactionId).toBeUndefined();
    });
  });

  describe('idempotency by merchantTransactionId (AC-2.6, AC-2.7)', () => {
    it('the same method, amount and bank answers 200 with the stored deal and selects nothing', async () => {
      const { deps, log, create } = build();
      deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
        deal({ amountFiat: toFiat(2037) }),
      );

      const outcome = await create();

      expect(outcome).toMatchObject({ created: false, sameRequest: false });
      expect(outcome.payment.id).toBe(DEAL);
      expect(outcome.payment.amount).toBe('2037.00');
      expect(deps.settings.settingsOf).not.toHaveBeenCalled();
      expect(deps.selection.issue).not.toHaveBeenCalled();
      expect(log.transactionId).toBe(DEAL);
    });

    it('another body is 409 DUPLICATE_MERCHANT_TRANSACTION_ID with the deal in details', async () => {
      for (const changed of [
        request({ amount: toFiat(2001) }),
        request({ method: 'counterparty', amount: toFiat(2000) }),
        request({ bank: 'tbank' }),
      ]) {
        const { deps, create } = build();
        deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
          deal(),
        );

        const refusal = await codeOf(create(changed));

        expect(refusal).toMatchObject({
          status: 409,
          code: 'DUPLICATE_MERCHANT_TRANSACTION_ID',
          details: { deal: { id: DEAL } },
        });
      }
    });

    it('a pay-out holding the key is a 409 too', async () => {
      const { deps, create } = build();
      deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
        deal({ kind: TransactionKind.PayOut }),
      );

      expect(await codeOf(create())).toMatchObject({ status: 409 });
    });

    it('a parallel duplicate that lost the race (unique index, or nothing left to issue) answers with the winner’s deal', async () => {
      const { deps, create } = build();
      deps.selection.issue.mockRejectedValueOnce(new Error('23505'));
      deps.transactions.findByMerchantTransactionId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(deal());

      const outcome = await create();

      expect(outcome).toMatchObject({ created: false });
      expect(outcome.payment.id).toBe(DEAL);
    });

    it('a failure with no deal under the key rethrows, so the key stays free', async () => {
      const { deps, create } = build();
      const failure = new BadRequestException('boom');
      deps.selection.issue.mockRejectedValueOnce(failure);

      await expect(create()).rejects.toBe(failure);
    });
  });

  describe('same requests (Q-MA03.5)', () => {
    it('on: an active deal of the client with the same requested amount and method is answered 200 with X-Same-Request, nothing issued', async () => {
      const { deps, log, create } = build();
      deps.settings.settingsOf.mockResolvedValue({
        ...(await deps.settings.settingsOf()),
        sameRequestsEnabled: true,
      });
      deps.transactions.findActiveSameRequest.mockResolvedValueOnce(
        deal({ merchantTransactionId: 'order-0' }),
      );

      const outcome = await create();

      expect(outcome).toMatchObject({ created: false, sameRequest: true });
      expect(outcome.payment.merchantTransactionId).toBe('order-0');
      expect(deps.transactions.findActiveSameRequest).toHaveBeenCalledWith({
        merchantId: MERCHANT,
        counterpartyId: 11,
        method: 'sbp',
        requestedAmountFiat: toFiat(2000),
      });
      expect(deps.selection.issue).not.toHaveBeenCalled();
      expect(log.transactionId).toBe(DEAL);
    });

    it('off: never looked up', async () => {
      const { deps, create } = build();

      await create();

      expect(deps.transactions.findActiveSameRequest).not.toHaveBeenCalled();
    });
  });

  describe('randomisation (Q-MA03.6)', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
      [0, 0, '2000.00'],
      [5, 0, '2000.00'],
      [5, 0.999999, '2005.00'],
      [50, 0.5, '2025.00'],
    ])(
      'window %i with draw %f issues %s and keeps the requested amount',
      async (window, draw, issued) => {
        const { deps, create } = build();
        jest.spyOn(Math, 'random').mockReturnValue(draw);
        deps.settings.settingsOf.mockResolvedValue({
          ...(await deps.settings.settingsOf()),
          randomizationWindow: window,
        });

        await create();

        const [selection] = deps.selection.issue.mock.calls[0] as unknown as [
          {
            amountFiat: ReturnType<typeof toFiat>;
            requestedAmountFiat: unknown;
          },
        ];
        expect(selection.amountFiat.toFixed(2)).toBe(issued);
        expect(selection.requestedAmountFiat).toEqual(toFiat(2000));
        expect(deps.rates.resolveMethodPercent).toHaveBeenCalledWith(
          expect.objectContaining({ amount: selection.amountFiat }),
        );
      },
    );
  });
});

describe('MerchantApiService: reading, canceling and extending', () => {
  it('answers a deal of its own with the issued requisite and the requested bank, in one read each', async () => {
    const { deps, service } = build();
    deps.deals.findOwn.mockResolvedValue(deal({ requestedBankId: 7 }));
    deps.banks.findByIds.mockResolvedValue([
      { id: 7, code: 'tbank', name: 'Т-банк' },
    ] as never);

    const payment = await service.findPayment(MERCHANT, DEAL);

    expect(deps.deals.findOwn).toHaveBeenCalledWith(MERCHANT, DEAL);
    expect(payment).toMatchObject({
      id: DEAL,
      bank: 'tbank',
      requisite: { sbpNumber: '+79010000001' },
    });
  });

  it('turns a missing or foreign deal into 404 DEAL_NOT_FOUND', async () => {
    const { deps, service } = build();
    deps.deals.findOwn.mockRejectedValue(new NotFoundException());

    await expect(codeOf(service.findPayment(MERCHANT, DEAL))).resolves.toEqual({
      status: 404,
      code: 'DEAL_NOT_FOUND',
      details: undefined,
    });
    await expect(
      codeOf(service.findPaymentByMerchantTransactionId(MERCHANT, 'nope')),
    ).resolves.toMatchObject({ status: 404, code: 'DEAL_NOT_FOUND' });
  });

  it('finds a deal by merchantTransactionId under the merchant', async () => {
    const { deps, service } = build();
    deps.transactions.findByMerchantTransactionId.mockResolvedValue(deal());

    await expect(
      service.findPaymentByMerchantTransactionId(MERCHANT, 'order-1'),
    ).resolves.toMatchObject({ id: DEAL, merchantTransactionId: 'order-1' });
    expect(deps.transactions.findByMerchantTransactionId).toHaveBeenCalledWith(
      MERCHANT,
      'order-1',
    );
  });

  it('composes a page with one requisite read and one bank read whatever the row count', async () => {
    const { deps, service } = build();
    const rows = [
      deal({ id: uuidOf(21), requestedBankId: 7 }),
      deal({ id: uuidOf(22), requestedBankId: 7 }),
      deal({ id: uuidOf(23), requestedBankId: null }),
    ];
    deps.deals.list.mockResolvedValue({
      items: rows,
      meta: { total: 3, page: 1, limit: 20, pages: 1 },
    });
    const query = {
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    } as never;

    const page = await service.listPayments(MERCHANT, query);

    expect(deps.deals.list).toHaveBeenCalledWith(MERCHANT, query);
    expect(page.items.map((item) => item.id)).toEqual(rows.map((r) => r.id));
    expect(page.meta.total).toBe(3);
    expect(deps.bankDetails.findByIdsWithDeleted).toHaveBeenCalledTimes(1);
    expect(deps.bankDetails.findByIdsWithDeleted).toHaveBeenCalledWith(
      [REQUISITE],
      expect.anything(),
    );
    expect(deps.banks.findByIds).toHaveBeenCalledTimes(1);
    expect(deps.banks.findByIds).toHaveBeenCalledWith([7], expect.anything());
  });

  it('cancels through the transactions owner and answers the canceled deal', async () => {
    const { deps, service } = build();
    deps.transactions.cancelByMerchant.mockResolvedValue(
      deal({ status: TransactionStatus.Canceled }),
    );

    await expect(service.cancelPayment(MERCHANT, DEAL)).resolves.toMatchObject({
      status: 'canceled',
    });
    expect(deps.transactions.cancelByMerchant).toHaveBeenCalledWith(
      MERCHANT,
      DEAL,
    );
  });

  it.each([
    ['cancelPayment', 'cancelByMerchant', 'DEAL_NOT_CANCELABLE'],
    ['extendPaymentTimer', 'extendTimerByMerchant', 'TIMER_NOT_EXTENDABLE'],
  ] as const)(
    '%s answers a refused deal 409 %s and a foreign one 404',
    async (method, owner, code) => {
      const { deps, service } = build();

      deps.transactions[owner].mockRejectedValueOnce(new ConflictException());
      await expect(codeOf(service[method](MERCHANT, DEAL))).resolves.toEqual({
        status: 409,
        code,
        details: undefined,
      });

      deps.transactions[owner].mockRejectedValueOnce(new NotFoundException());
      await expect(
        codeOf(service[method](MERCHANT, DEAL)),
      ).resolves.toMatchObject({ status: 404, code: 'DEAL_NOT_FOUND' });
    },
  );

  it('answers the extended deal with its moved expiresAt', async () => {
    const { deps, service } = build();
    const extended = deal({
      expiresAt: new Date('2026-11-04T10:30:00Z'),
      timerExtendedAt: new Date('2026-11-04T10:05:00Z'),
    });
    deps.transactions.extendTimerByMerchant.mockResolvedValue(extended);

    await expect(
      service.extendPaymentTimer(MERCHANT, DEAL),
    ).resolves.toMatchObject({ expiresAt: extended.expiresAt });
  });
});

describe('MerchantApiService.createPayOut', () => {
  const buildPayOut = () => {
    const built = build();

    built.deps.methods.statesByMerchant.mockResolvedValue(
      new Map([
        [
          MERCHANT,
          [
            { method: 'sbp', payInEnabled: true, payOutEnabled: false },
            { method: 'card', payInEnabled: false, payOutEnabled: true },
          ],
        ],
      ]),
    );
    built.deps.currencies.currenciesByMerchant.mockResolvedValue(
      new Map([
        [
          MERCHANT,
          [
            {
              currency: { isocode: 'RUB' },
              payInMarkupPercent: 2,
              payOutMarkupPercent: -1.5,
            },
          ],
        ],
      ]) as never,
    );
    built.deps.banks.findByIds.mockResolvedValue([
      { id: 7, code: 'tbank', name: 'Т-банк' },
    ] as never);

    const createPayOut = (input: PayOutRequest = payOutRequest()) =>
      built.service.createPayOut(MERCHANT, input, built.log);

    return { ...built, createPayOut };
  };

  it('creates a pending pay-out with no trader, priced at the pay-out markup and percent, the recipient answered whole', async () => {
    const { deps, log, createPayOut } = buildPayOut();

    const outcome = await createPayOut(
      payOutRequest({
        timeoutInMin: 30,
        callbackUrl: 'https://merchant.example/cb',
        payerInfo: { userId: 'client-9' },
      }),
    );

    expect(outcome.created).toBe(true);
    expect(outcome.payment).toMatchObject({
      type: TransactionKind.PayOut,
      status: TransactionStatus.Pending,
      requisite: {
        bank: { code: 'tbank', name: 'Т-банк' },
        cardNumber: '4111111111111111',
        sbpNumber: null,
        ownerName: 'PETR PETROV',
      },
    });
    expect(deps.rates.merchantSourceRate).toHaveBeenCalledWith(-1.5);
    expect(deps.rates.resolveMethodPercent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'merchant',
        subjectMerchantId: MERCHANT,
        direction: 'payOut',
        method: 'card',
        amount: toFiat(5000),
        bankId: 7,
      }),
    );
    expect(deps.transactions.createPayOutRequest).toHaveBeenCalledWith({
      method: 'card',
      merchantId: MERCHANT,
      merchantTransactionId: 'payout-1',
      amountFiat: toFiat(5000),
      rate: toRate(92.7),
      merchantPercent: 10,
      windowMinutes: 30,
      payoutOwnerName: 'PETR PETROV',
      payoutBankId: 7,
      payoutCardNumber: '4111111111111111',
      payoutPhone: null,
      payerInfo: { userId: 'client-9' },
      callbackUrl: 'https://merchant.example/cb',
    });
    expect(deps.selection.issue).not.toHaveBeenCalled();
    expect(log).toMatchObject({
      operation: 'pay_out_create',
      direction: TransactionKind.PayOut,
      paymentMethod: 'card',
      currency: 'RUB',
      requestedBankId: 7,
      payerUserId: 'client-9',
      merchantTransactionId: 'payout-1',
      transactionId: DEAL,
      processedByUserId: null,
    });
  });

  it('leaves the window to the merchant settings when timeoutInMin is absent', async () => {
    const { deps, createPayOut } = buildPayOut();

    await createPayOut();

    expect(deps.transactions.createPayOutRequest).toHaveBeenCalledWith(
      expect.objectContaining({ windowMinutes: null, payerInfo: null }),
    );
  });

  describe('the order of refusals (AC-5.2)', () => {
    it('a method that does not pay out is 400 METHOD_NOT_SUPPORTED, before the switches are read', async () => {
      const { deps, createPayOut } = buildPayOut();

      for (const method of ['counterparty', 'mobile_commerce', 'qr']) {
        expect(
          await codeOf(createPayOut(payOutRequest({ method }))),
        ).toMatchObject({ status: 400, code: 'METHOD_NOT_SUPPORTED' });
      }
      expect(deps.methods.statesByMerchant).not.toHaveBeenCalled();
    });

    it('a currency other than the method’s is 400 CURRENCY_MISMATCH', async () => {
      const { createPayOut } = buildPayOut();

      expect(
        await codeOf(createPayOut(payOutRequest({ currency: 'KZT' }))),
      ).toMatchObject({ status: 400, code: 'CURRENCY_MISMATCH' });
    });

    it('pay-out switched off is 403 METHOD_DISABLED even with pay-in on, before the bank', async () => {
      const { deps, createPayOut } = buildPayOut();

      expect(
        await codeOf(
          createPayOut(
            payOutRequest({
              method: 'sbp',
              requisite: {
                ownerName: 'X',
                bank: 'tbank',
                sbpNumber: '79001234567',
              },
            }),
          ),
        ),
      ).toMatchObject({ status: 403, code: 'METHOD_DISABLED' });
      expect(deps.banks.findActiveByCode).not.toHaveBeenCalled();
    });

    it('an unknown recipient bank is 400 BANK_NOT_FOUND, before the idempotency lookup', async () => {
      const { deps, createPayOut } = buildPayOut();

      expect(
        await codeOf(
          createPayOut(
            payOutRequest({
              requisite: {
                ownerName: 'X',
                bank: 'nobank',
                cardNumber: '4111111111111111',
              },
            }),
          ),
        ),
      ).toMatchObject({ status: 400, code: 'BANK_NOT_FOUND' });
      expect(
        deps.transactions.findByMerchantTransactionId,
      ).not.toHaveBeenCalled();
    });

    it('no merchant rate is 403 RATE_NOT_FOUND; Rapira down is 503 RATE_UNAVAILABLE; nothing created', async () => {
      const { deps, createPayOut } = buildPayOut();

      deps.rates.resolveMethodPercent.mockRejectedValueOnce(
        new NoBaseRateError(),
      );
      expect(await codeOf(createPayOut())).toMatchObject({
        status: 403,
        code: 'RATE_NOT_FOUND',
      });

      deps.rates.merchantSourceRate.mockRejectedValueOnce(
        new ServiceUnavailableException(),
      );
      expect(await codeOf(createPayOut())).toMatchObject({
        status: 503,
        code: 'RATE_UNAVAILABLE',
      });
      expect(deps.transactions.createPayOutRequest).not.toHaveBeenCalled();
    });

    it('a hold the balance does not cover is 409 INSUFFICIENT_BALANCE, and the key stays free', async () => {
      const { deps, log, createPayOut } = buildPayOut();
      deps.transactions.createPayOutRequest.mockRejectedValueOnce(
        new ConflictException(
          'The merchant balance does not cover the pay-out',
        ),
      );

      expect(await codeOf(createPayOut())).toMatchObject({
        status: 409,
        code: 'INSUFFICIENT_BALANCE',
      });
      expect(
        deps.transactions.findByMerchantTransactionId,
      ).toHaveBeenCalledTimes(2);
      expect(log.transactionId).toBeUndefined();
    });

    it('any other failure with no deal under the key rethrows', async () => {
      const { deps, createPayOut } = buildPayOut();
      const failure = new Error('boom');
      deps.transactions.createPayOutRequest.mockRejectedValueOnce(failure);

      await expect(createPayOut()).rejects.toBe(failure);
    });
  });

  describe('idempotency (AC-2.6)', () => {
    it('the same method, amount and recipient answers 200 with the stored deal and creates nothing', async () => {
      const { deps, log, createPayOut } = buildPayOut();
      deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
        payOutDeal(),
      );

      const outcome = await createPayOut(payOutRequest({ timeoutInMin: 90 }));

      expect(outcome).toMatchObject({ created: false });
      expect(outcome.payment.id).toBe(DEAL);
      expect(deps.transactions.createPayOutRequest).not.toHaveBeenCalled();
      expect(deps.rates.merchantSourceRate).not.toHaveBeenCalled();
      expect(log.transactionId).toBe(DEAL);
    });

    it.each([
      ['another amount', payOutRequest({ amount: toFiat(5001) })],
      [
        'another owner',
        payOutRequest({
          requisite: {
            ownerName: 'IVAN',
            bank: 'tbank',
            cardNumber: '4111111111111111',
          },
        }),
      ],
      [
        'another card',
        payOutRequest({
          requisite: {
            ownerName: 'PETR PETROV',
            bank: 'tbank',
            cardNumber: '5555555555554444',
          },
        }),
      ],
    ])(
      '%s is 409 DUPLICATE_MERCHANT_TRANSACTION_ID with the deal',
      async (_case, sent) => {
        const { deps, createPayOut } = buildPayOut();
        deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
          payOutDeal(),
        );

        const refused = await codeOf(createPayOut(sent));

        expect(refused).toMatchObject({
          status: 409,
          code: 'DUPLICATE_MERCHANT_TRANSACTION_ID',
          details: { deal: { id: DEAL, type: TransactionKind.PayOut } },
        });
      },
    );

    it('another recipient bank is a 409 too', async () => {
      const { deps, createPayOut } = buildPayOut();
      deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
        payOutDeal({ payoutBankId: 8 }),
      );

      expect(await codeOf(createPayOut())).toMatchObject({ status: 409 });
    });

    it('a pay-in holding the key is a 409', async () => {
      const { deps, createPayOut } = buildPayOut();
      deps.transactions.findByMerchantTransactionId.mockResolvedValueOnce(
        deal({ merchantTransactionId: 'payout-1' }),
      );

      expect(await codeOf(createPayOut())).toMatchObject({
        status: 409,
        code: 'DUPLICATE_MERCHANT_TRANSACTION_ID',
      });
    });

    it('a parallel duplicate that lost the race on the unique index answers with the winner’s deal', async () => {
      const { deps, createPayOut } = buildPayOut();
      deps.transactions.createPayOutRequest.mockRejectedValueOnce(
        new Error('23505'),
      );
      deps.transactions.findByMerchantTransactionId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(payOutDeal());

      const outcome = await createPayOut();

      expect(outcome).toMatchObject({ created: false });
      expect(outcome.payment.id).toBe(DEAL);
    });
  });
});
