import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { MerchantDealsController } from '../controllers/merchant-deals.controller';
import { ListMerchantDealsQueryDto } from '../dto/list-merchant-deals-query.dto';
import { MerchantDealFilterDto } from '../dto/merchant-deal-filter.dto';
import { MerchantDealSortField } from '../types/merchant-deal-sort-field.enum';

const MERCHANT = uuidOf(30);
const DEAL = uuidOf(50);
const REQUISITE = uuidOf(60);
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const deal = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: DEAL,
    kind: TransactionKind.PayIn,
    status: TransactionStatus.Active,
    method: 'sbp',
    traderUserId: uuidOf(1),
    bankDetailsId: REQUISITE,
    counterpartyId: 9,
    merchantId: MERCHANT,
    amountFiat: toFiat('450.5'),
    amountCrypto: toCrypto('5.089245'),
    rate: toRate('88.52'),
    merchantAmount: toCrypto('4.7'),
    merchantCommission: toCrypto('0.389245'),
    traderCommission: toCrypto(1),
    traderPercent: 6,
    createdAt: new Date('2025-08-22T12:40:00Z'),
    expiresAt: new Date('2025-08-22T12:55:00Z'),
    resolvedAt: null,
    ...overrides,
  }) as Transaction;

const counts = (values: Partial<Record<TransactionStatus, number>>) =>
  Object.fromEntries(
    Object.values(TransactionStatus).map((status) => [
      status,
      values[status] ?? 0,
    ]),
  );

describe('MerchantDealsController', () => {
  const build = () => {
    const deals = {
      list: jest.fn(async () => toPage([[deal()], 1], { page: 1, limit: 20 })),
      export: jest.fn(async () => [deal()]),
      statusCounts: jest.fn(async (_merchantId: string, filter?: object) =>
        filter
          ? counts({
              [TransactionStatus.Active]: 15,
              [TransactionStatus.Pending]: 2,
              [TransactionStatus.Dispute]: 3,
              [TransactionStatus.ManualReview]: 1,
              [TransactionStatus.Success]: 4,
            })
          : counts({
              [TransactionStatus.Active]: 25,
              [TransactionStatus.Checking]: 3,
              [TransactionStatus.CheckingManually]: 1,
              [TransactionStatus.Pending]: 3,
            }),
      ),
      findOwn: jest.fn(async () => deal()),
      statusHistory: jest.fn(async () => [
        {
          fromStatus: null,
          toStatus: TransactionStatus.Active,
          source: 'system',
          actorUserId: uuidOf(9),
          reason: 'internal',
          createdAt: new Date('2025-08-22T12:40:00Z'),
        },
      ]),
    };
    const bankDetails = {
      findByIdsWithDeleted: jest.fn(async () => [
        {
          id: REQUISITE,
          type: 'phone',
          cardholderName: 'Шевченко Д.',
          phone: '+79012345678',
          card: null,
          bank: { id: 4, name: 'Т-банк' },
        },
      ]),
    };
    const counterparties = {
      findByIds: jest.fn(async () => [{ id: 9, name: 'client-9' }]),
    };
    const config = { getOrThrow: jest.fn(() => 'Europe/Moscow') };

    return {
      deals,
      controller: new MerchantDealsController(
        deals as never,
        bankDetails as never,
        counterparties as never,
        config as never,
      ),
    };
  };

  it('lists the merchant’s deals with the requisite whole and no trader', async () => {
    const { controller, deals } = build();

    const page = await controller.list(MERCHANT, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Asc,
      sortBy: MerchantDealSortField.ExpiresAt,
      status: [TransactionStatus.Dispute, TransactionStatus.ManualReview],
      createdFrom: '2025-08-22',
      amountFrom: '100.00',
      search: 'ab12',
    } as ListMerchantDealsQueryDto);

    expect(deals.list).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({
        statuses: [TransactionStatus.Dispute, TransactionStatus.ManualReview],
        createdFrom: new Date('2025-08-21T21:00:00Z'),
        amountFrom: toFiat('100'),
        idSearch: 'ab12',
        sortBy: TransactionSortField.ExpiresAt,
        sortOrder: SortOrder.Asc,
      }),
    );
    expect(page.items[0]).toEqual({
      id: DEAL,
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      method: 'sbp',
      createdAt: new Date('2025-08-22T12:40:00Z'),
      expiresAt: new Date('2025-08-22T12:55:00Z'),
      resolvedAt: null,
      amountFiat: '450.50',
      currency: 'RUB',
      rate: '88.520000',
      amountCrypto: '5.089245',
      merchantAmount: '4.700000',
      merchantCommission: '0.389245',
      requisite: {
        bank: { id: 4, name: 'Т-банк' },
        type: 'phone',
        cardholderName: 'Шевченко Д.',
        phone: '+79012345678',
        card: null,
      },
      counterparty: { id: 9, name: 'client-9' },
    });
    expect(JSON.stringify(page.items[0])).not.toContain(uuidOf(1));
  });

  it('counts the tabs under the filters without the status, and the cards now', async () => {
    const { controller, deals } = build();

    const counters = await controller.counters(MERCHANT, {
      status: [TransactionStatus.Success],
      search: 'ab12',
    });

    expect(deals.statusCounts).toHaveBeenCalledWith(
      MERCHANT,
      expect.objectContaining({ statuses: undefined, idSearch: 'ab12' }),
    );
    expect(deals.statusCounts).toHaveBeenCalledWith(MERCHANT);
    expect(counters).toEqual({
      tabs: {
        all: 25,
        active: 15,
        pending: 2,
        dispute: 4,
        checking: 0,
        checking_manually: 0,
        success_changed: 0,
        success: 4,
        canceled: 0,
      },
      kpi: { active: 25, onCheck: 4, pending: 3 },
    });
  });

  it('answers one deal with its status history and no actor', async () => {
    const { controller, deals } = build();

    const detail = await controller.findOne(MERCHANT, DEAL);

    expect(deals.findOwn).toHaveBeenCalledWith(MERCHANT, DEAL);
    expect(detail.statusHistory).toEqual([
      {
        fromStatus: null,
        toStatus: TransactionStatus.Active,
        createdAt: new Date('2025-08-22T12:40:00Z'),
      },
    ]);
  });

  it('exports a CSV of the filtered deals', async () => {
    const { controller, deals } = build();

    const file = await controller.export(MERCHANT, {});
    const text = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      file
        .getStream()
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });

    expect(deals.export).toHaveBeenCalledWith(
      MERCHANT,
      expect.any(Object),
      100000,
    );
    expect(text.split('\r\n')[1]).toBe(
      `${DEAL},pay_in,active,sbp,2025-08-22T12:40:00.000Z,,450.50,RUB,88.520000,5.089245,0.389245,4.700000,Т-банк,'+79012345678`,
    );
  });

  it.each([
    [{ search: 'ab1' }],
    [{ status: 'expired' }],
    [{ amountFrom: 100 }],
    [{ amountFrom: '200.00', amountTo: '100.00' }],
    [{ merchantId: uuidOf(31) }],
  ])('refuses %p with a 400', async (query) => {
    await expect(
      pipe.transform(query, { type: 'query', metatype: MerchantDealFilterDto }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a sort field the cabinet does not offer', async () => {
    await expect(
      pipe.transform(
        { sortBy: 'merchant' },
        { type: 'query', metatype: ListMerchantDealsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
