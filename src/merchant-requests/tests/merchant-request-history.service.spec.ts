import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Brackets } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { formatFiat } from '../../common/utils/format-fiat';
import { toFiat } from '../../common/utils/to-fiat';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantRequestHistoryService } from '../services/merchant-request-history.service';
import { MerchantRequestListQuery } from '../types/merchant-request-list-query';
import { MerchantRequestOperation } from '../types/merchant-request-operation.enum';
import { MerchantRequestResult } from '../types/merchant-request-result.enum';
import { MerchantRequestSortField } from '../types/merchant-request-sort-field.enum';
import { MerchantRequestSummary } from '../types/merchant-request-summary';

const MERCHANT_A = uuidOf(901);
const MERCHANT_B = uuidOf(902);

const at = (minute: number): Date => new Date(Date.UTC(2026, 10, 1, 0, minute));

const summary = (
  n: number,
  minute: number,
  overrides: Partial<MerchantRequestSummary> = {},
): MerchantRequestSummary => ({
  id: uuidOf(n),
  merchantId: MERCHANT_A,
  statusCode: 201,
  errorCode: null,
  durationMs: 40,
  result: MerchantRequestResult.Created,
  operation: MerchantRequestOperation.PayInCreate,
  direction: TransactionKind.PayIn,
  paymentMethod: 'sbp',
  amountFiat: toFiat(1000),
  currency: 'RUB',
  requestedBankId: null,
  payerUserId: `client-${n}`,
  merchantTransactionId: `order-${n}`,
  transactionId: null,
  processedByUserId: null,
  receivedAt: at(minute),
  ...overrides,
});

type Condition = [string, Record<string, unknown> | undefined];

const passes = (row: MerchantRequestSummary, [sql, params]: Condition) => {
  const value = (key: string) => params?.[key];

  switch (sql) {
    case 'request.receivedAt >= :receivedFrom':
      return row.receivedAt >= (value('receivedFrom') as Date);
    case 'request.receivedAt < :receivedBefore':
      return row.receivedAt < (value('receivedBefore') as Date);
    case 'request.result = :result':
      return row.result === value('result');
    case 'request.merchantId = :merchantId':
      return row.merchantId === value('merchantId');
    case 'request.amountFiat IS NOT NULL':
      return row.amountFiat !== null;
    case 'request.amountFiat IS NULL':
      return row.amountFiat === null;
    case 'request.payerUserId IS NOT NULL':
      return row.payerUserId !== null;
    case 'request.payerUserId IS NULL':
      return row.payerUserId === null;
    default:
      return true;
  }
};

const compareValues = (a: unknown, b: unknown): number => {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }

  if (typeof a === 'object' && a !== null && 'comparedTo' in a) {
    return (a as ReturnType<typeof toFiat>).comparedTo(
      b as ReturnType<typeof toFiat>,
    );
  }

  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

const POSTGRES_COLUMN: Record<string, keyof MerchantRequestSummary> = {
  'request.receivedAt': 'receivedAt',
  'request.id': 'id',
  'request.amountFiat': 'amountFiat',
  '"request"."payerUserId" COLLATE "C"': 'payerUserId',
};

const postgresFake = (rows: () => MerchantRequestSummary[]) => {
  const builders: {
    conditions: Condition[];
    orders: [string, string][];
    brackets: Brackets[];
  }[] = [];

  const createQueryBuilder = () => {
    const conditions: Condition[] = [];
    const orders: [string, string][] = [];
    const brackets: Brackets[] = [];
    let offset = 0;
    let limit = Number.POSITIVE_INFINITY;
    let groupBy: keyof MerchantRequestSummary | null = null;
    const matching = () =>
      rows().filter((row) => conditions.every((c) => passes(row, c)));
    const sorted = () =>
      [...matching()].sort((a, b) => {
        for (const [expression, direction] of orders) {
          const column = POSTGRES_COLUMN[expression];
          const order = compareValues(a[column], b[column]);

          if (order !== 0) return direction === 'ASC' ? order : -order;
        }

        return 0;
      });
    const builder: Record<string, unknown> = {
      andWhere: (sql: string | Brackets, params?: Record<string, unknown>) => {
        if (sql instanceof Brackets) brackets.push(sql);
        else conditions.push([sql, params]);

        return builder;
      },
      select: (expression: string | string[]) => {
        if (typeof expression === 'string') {
          groupBy = expression.replace(
            'request.',
            '',
          ) as keyof MerchantRequestSummary;
        }

        return builder;
      },
      addSelect: () => builder,
      groupBy: () => builder,
      orderBy: (expression: string, direction: string) => {
        orders.push([expression, direction]);

        return builder;
      },
      addOrderBy: (expression: string, direction: string) => {
        orders.push([expression, direction]);

        return builder;
      },
      offset: (value: number) => {
        offset = value;

        return builder;
      },
      limit: (value: number) => {
        limit = value;

        return builder;
      },
      getCount: async () => matching().length,
      getManyAndCount: async () => [
        sorted().slice(offset, offset + limit),
        matching().length,
      ],
      getRawMany: async () => {
        const counts = new Map<string, number>();

        for (const row of matching()) {
          const key = String(row[groupBy as keyof MerchantRequestSummary]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        return [...counts].map(([key, total]) => ({
          key,
          total: String(total),
        }));
      },
      getRawOne: async () => {
        const all = rows();

        return {
          oldest:
            all.length === 0
              ? null
              : new Date(Math.min(...all.map((r) => r.receivedAt.getTime()))),
        };
      },
    };

    builders.push({ conditions, orders, brackets });

    return builder;
  };

  return { createQueryBuilder, builders };
};

const lineOf = (row: MerchantRequestSummary): Record<string, string> => ({
  requestId: row.id,
  merchantId: row.merchantId,
  statusCode: String(row.statusCode),
  errorCode: row.errorCode ?? '',
  durationMs: String(row.durationMs),
  result: row.result,
  operation: row.operation ?? '',
  direction: row.direction ?? '',
  paymentMethod: row.paymentMethod ?? '',
  amountFiat: row.amountFiat === null ? '' : formatFiat(row.amountFiat),
  currency: row.currency ?? '',
  requestedBankId:
    row.requestedBankId === null ? '' : String(row.requestedBankId),
  payerUserId: row.payerUserId ?? '',
  merchantTransactionId: row.merchantTransactionId ?? '',
  transactionId: row.transactionId ?? '',
  processedByUserId: row.processedByUserId ?? '',
  receivedAt: row.receivedAt.toISOString(),
});

const victoriaFake = (archived: () => MerchantRequestSummary[]) => {
  const run = (logsql: string): Record<string, string>[] => {
    const [filter, ...pipes] = logsql.split(' | ');
    const range = /receivedAt:string_range\("([^"]*)", "([^"]*)"\)/.exec(
      filter,
    );
    const exact = [...filter.matchAll(/(\w+):="([^"]*)"/g)].filter(
      ([, field]) => field !== 'source',
    );
    const present = [...filter.matchAll(/(\w+):\*/g)].map(([, f]) => f);
    const empty = [...filter.matchAll(/(\w+):""/g)].map(([, f]) => f);
    const lines = archived()
      .map(lineOf)
      .filter(
        (line) =>
          (!range ||
            (line.receivedAt >= range[1] && line.receivedAt < range[2])) &&
          exact.every(([, field, value]) => line[field] === value) &&
          present.every((field) => line[field] !== '') &&
          empty.every((field) => line[field] === ''),
      );
    const stats = pipes.find((pipe) => pipe.startsWith('stats'));

    if (stats === 'stats count_uniq(requestId) total') {
      return [{ total: String(lines.length) }];
    }

    const groupedBy = /^stats by \((\w+)\)/.exec(stats ?? '');

    if (groupedBy) {
      const counts = new Map<string, number>();

      for (const line of lines) {
        const key = line[groupedBy[1]];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      return [...counts].map(([key, total]) => ({
        [groupedBy[1]]: key,
        total: String(total),
      }));
    }

    const page = /^sort by \(([^)]*)\) offset (\d+) limit (\d+)$/.exec(
      pipes[pipes.length - 1],
    );

    if (!page) return lines.slice(0, 1);

    const keys = page[1].split(', ').map((key) => key.split(' '));

    return lines
      .sort((a, b) => {
        for (const [field, direction] of keys) {
          const order =
            field === 'amountFiat'
              ? Number(a[field]) - Number(b[field])
              : compareValues(a[field], b[field]);

          if (order !== 0) return direction === 'desc' ? -order : order;
        }

        return 0;
      })
      .slice(Number(page[2]), Number(page[2]) + Number(page[3]));
  };

  return {
    enabled: true,
    selectScoped: jest.fn(async (logsql: string) => run(logsql)),
  };
};

const ids = (rows: MerchantRequestSummary[]) => rows.map((row) => row.id);

describe('MerchantRequestHistoryService', () => {
  let stored: MerchantRequestSummary[];
  let archived: MerchantRequestSummary[];
  let postgres: ReturnType<typeof postgresFake>;
  let victoria: ReturnType<typeof victoriaFake>;
  let findOne: jest.Mock;
  let service: MerchantRequestHistoryService;

  const last = () => postgres.builders[postgres.builders.length - 1];

  const query = (
    overrides: Partial<MerchantRequestListQuery> = {},
  ): MerchantRequestListQuery => ({
    page: 1,
    limit: 20,
    sortBy: MerchantRequestSortField.ReceivedAt,
    sortOrder: SortOrder.Desc,
    ...overrides,
  });

  beforeEach(() => {
    stored = [];
    archived = [];
    postgres = postgresFake(() => stored);
    victoria = victoriaFake(() => archived);
    findOne = jest.fn(async () => null);
    service = new MerchantRequestHistoryService(
      { createQueryBuilder: postgres.createQueryBuilder, findOne } as never,
      victoria as never,
    );
  });

  describe('without the archive', () => {
    beforeEach(() => {
      victoria.enabled = false;
    });

    it('reads Postgres only, newest first, tie-broken on the id', async () => {
      stored = [summary(1, 1), summary(2, 2), summary(3, 2)];

      const page = await service.list(query());

      expect(ids(page.items)).toEqual([uuidOf(3), uuidOf(2), uuidOf(1)]);
      expect(page.meta).toEqual({ total: 3, page: 1, limit: 20, pages: 1 });
      expect(victoria.selectScoped).not.toHaveBeenCalled();
      expect(last().orders).toEqual([
        ['request.receivedAt', 'DESC'],
        ['request.id', 'DESC'],
      ]);
    });

    it('turns every filter into SQL, money as a formatted string', async () => {
      await service.list(
        query({
          result: MerchantRequestResult.NotCreated,
          merchantId: MERCHANT_A,
          receivedFrom: at(0),
          receivedBefore: at(60),
          amountFrom: toFiat(100),
          amountTo: toFiat('2000.5'),
          requestedBankId: 7,
          paymentMethod: 'sbp',
          direction: TransactionKind.PayIn,
          operations: [MerchantRequestOperation.PayInCreate],
        }),
      );

      expect(last().conditions).toEqual([
        ['request.receivedAt >= :receivedFrom', { receivedFrom: at(0) }],
        ['request.receivedAt < :receivedBefore', { receivedBefore: at(60) }],
        ['request.result = :result', { result: 'not_created' }],
        ['request.merchantId = :merchantId', { merchantId: MERCHANT_A }],
        [
          'request.operation IN (:...operations)',
          { operations: ['pay_in_create'] },
        ],
        ['request.direction = :direction', { direction: 'pay_in' }],
        ['request.paymentMethod = :paymentMethod', { paymentMethod: 'sbp' }],
        ['request.requestedBankId = :requestedBankId', { requestedBankId: 7 }],
        ['request.amountFiat >= :amountFrom', { amountFrom: '100.00' }],
        ['request.amountFiat <= :amountTo', { amountTo: '2000.50' }],
      ]);
    });

    it('reads «any bank» as a request that named none', async () => {
      await service.list(query({ requestedBankId: null }));

      expect(last().conditions).toEqual([
        ['request.requestedBankId IS NULL', undefined],
      ]);
    });

    it('searches the exact merchantTransactionId, the ids when the term is a uuid, and the merchants matched by name', async () => {
      const search = async (term: string, merchantIds: string[]) => {
        await service.list(
          query({ search: term, searchMerchantIds: merchantIds }),
        );

        const [brackets] = last().brackets;
        const inner = { where: jest.fn(), orWhere: jest.fn() };
        inner.where.mockReturnValue(inner);
        inner.orWhere.mockReturnValue(inner);
        (brackets.whereFactory as (qb: unknown) => void)(inner);

        return inner;
      };

      const byUuid = await search(uuidOf(5), [MERCHANT_B]);

      expect(byUuid.where).toHaveBeenCalledWith(
        'request.merchantTransactionId = :search',
        { search: uuidOf(5) },
      );
      expect(byUuid.orWhere.mock.calls).toEqual([
        ['request.id = :searchId', { searchId: uuidOf(5) }],
        ['request.transactionId = :searchId'],
        [
          'request.merchantId IN (:...searchMerchantIds)',
          { searchMerchantIds: [MERCHANT_B] },
        ],
      ]);

      const byText = await search('order-5', []);

      expect(byText.orWhere).not.toHaveBeenCalled();
    });

    it('sorts by amount with requests without one last when newest-largest first', async () => {
      stored = [
        summary(1, 1, { amountFiat: toFiat(500) }),
        summary(2, 2, { amountFiat: null }),
        summary(3, 3, { amountFiat: toFiat(900) }),
      ];

      const desc = await service.list(
        query({ sortBy: MerchantRequestSortField.Amount }),
      );
      const asc = await service.list(
        query({
          sortBy: MerchantRequestSortField.Amount,
          sortOrder: SortOrder.Asc,
        }),
      );

      expect(ids(desc.items)).toEqual([uuidOf(3), uuidOf(1), uuidOf(2)]);
      expect(ids(asc.items)).toEqual([uuidOf(2), uuidOf(1), uuidOf(3)]);
      expect(desc.meta.total).toBe(3);
    });

    it('sorts payerUserId by code unit in SQL', async () => {
      stored = [
        summary(1, 1, { payerUserId: 'b' }),
        summary(2, 2, { payerUserId: 'B' }),
      ];

      const page = await service.list(
        query({
          sortBy: MerchantRequestSortField.PayerUserId,
          sortOrder: SortOrder.Asc,
        }),
      );

      expect(ids(page.items)).toEqual([uuidOf(2), uuidOf(1)]);
      expect(
        postgres.builders.some(({ orders }) =>
          orders.some(([expression]) => expression.includes('COLLATE "C"')),
        ),
      ).toBe(true);
    });

    it('sorts by merchant name rank, then newest first within a merchant', async () => {
      stored = [
        summary(1, 1, { merchantId: MERCHANT_A }),
        summary(2, 2, { merchantId: MERCHANT_B }),
        summary(3, 3, { merchantId: MERCHANT_A }),
      ];
      const merchantRanks = new Map([
        [MERCHANT_A, 1],
        [MERCHANT_B, 0],
      ]);

      const asc = await service.list(
        query({
          sortBy: MerchantRequestSortField.Merchant,
          sortOrder: SortOrder.Asc,
          merchantRanks,
        }),
      );
      const secondPage = await service.list(
        query({
          sortBy: MerchantRequestSortField.Merchant,
          sortOrder: SortOrder.Desc,
          merchantRanks,
          page: 2,
          limit: 2,
        }),
      );

      expect(ids(asc.items)).toEqual([uuidOf(2), uuidOf(1), uuidOf(3)]);
      expect(ids(secondPage.items)).toEqual([uuidOf(2)]);
      expect(secondPage.meta.total).toBe(3);
    });

    it('counts the tabs without the result filter', async () => {
      stored = [
        summary(1, 1),
        summary(2, 2, { result: MerchantRequestResult.NotCreated }),
        summary(3, 3, { result: MerchantRequestResult.Ok, operation: null }),
      ];

      expect(
        await service.counters({ result: MerchantRequestResult.Created }),
      ).toEqual({ all: 3, created: 1, notCreated: 1 });
    });

    it('exports newest first and refuses more rows than the cap', async () => {
      stored = [summary(1, 1), summary(2, 2), summary(3, 3)];

      expect(ids(await service.export({}, 3))).toEqual([
        uuidOf(3),
        uuidOf(2),
        uuidOf(1),
      ]);
      await expect(service.export({}, 2)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('finds a row in Postgres and answers null for an unknown one', async () => {
      const row = { id: uuidOf(1) };
      findOne.mockResolvedValueOnce(row);

      expect(await service.findById(uuidOf(1))).toBe(row);
      expect(await service.findById(uuidOf(2))).toBeNull();
      expect(victoria.selectScoped).not.toHaveBeenCalled();
    });
  });

  describe('with the archive', () => {
    it('asks the archive only for rows received before the oldest one Postgres holds', async () => {
      stored = [summary(3, 30)];
      archived = [summary(1, 10)];

      await service.list(query({ receivedBefore: at(60) }));

      expect(victoria.selectScoped.mock.calls[0][0]).toBe(
        `source:="merchant_api" receivedAt:string_range("0", "${at(30).toISOString()}") | stats count_uniq(requestId) total`,
      );
    });

    it('asks for everything when Postgres is empty, bounded by the period', async () => {
      archived = [summary(1, 10)];

      await service.list(
        query({ receivedFrom: at(5), receivedBefore: at(60) }),
      );

      expect(victoria.selectScoped.mock.calls[0][0]).toContain(
        `receivedAt:string_range("${at(5).toISOString()}", "${at(60).toISOString()}")`,
      );
    });

    it('does not ask the archive when the period ends before it begins', async () => {
      stored = [summary(3, 30)];
      archived = [summary(1, 10)];

      const page = await service.list(query({ receivedFrom: at(30) }));

      expect(victoria.selectScoped).not.toHaveBeenCalled();
      expect(page.meta.total).toBe(1);
    });

    it('turns every filter into LogsQL, de-duplicates by request id and reads only the list fields', async () => {
      stored = [summary(3, 30)];
      archived = [summary(1, 10)];

      await service.list(
        query({
          result: MerchantRequestResult.Created,
          merchantId: MERCHANT_A,
          operations: [
            MerchantRequestOperation.PayInCreate,
            MerchantRequestOperation.PayOutCreate,
          ],
          direction: TransactionKind.PayIn,
          paymentMethod: 'sbp',
          requestedBankId: 7,
          amountFrom: toFiat(100),
          amountTo: toFiat(2000),
          search: 'order-1',
          searchMerchantIds: [MERCHANT_B],
        }),
      );

      const filter = [
        'source:="merchant_api"',
        `receivedAt:string_range("0", "${at(30).toISOString()}")`,
        'result:="created"',
        `merchantId:="${MERCHANT_A}"`,
        'operation:in("pay_in_create","pay_out_create")',
        'direction:="pay_in"',
        'paymentMethod:="sbp"',
        'requestedBankId:="7"',
        'amountFiat:>=100.00',
        'amountFiat:<=2000.00',
        `(requestId:="order-1" or transactionId:="order-1" or merchantTransactionId:="order-1" or merchantId:in("${MERCHANT_B}"))`,
      ].join(' ');

      expect(victoria.selectScoped.mock.calls.map(([q]) => q)).toEqual([
        `${filter} | stats count_uniq(requestId) total`,
      ]);

      archived = [
        summary(1, 10, {
          merchantTransactionId: 'order-1',
          requestedBankId: 7,
        }),
      ];
      victoria.selectScoped.mockClear();
      await service.list(
        query({ requestedBankId: 7, sortOrder: SortOrder.Asc }),
      );

      expect(victoria.selectScoped.mock.calls[1][0]).toBe(
        `source:="merchant_api" receivedAt:string_range("0", "${at(30).toISOString()}") requestedBankId:="7" | fields requestId, merchantId, statusCode, errorCode, durationMs, result, operation, direction, paymentMethod, amountFiat, currency, requestedBankId, payerUserId, merchantTransactionId, transactionId, processedByUserId, receivedAt | sort by (requestId) partition by (requestId) limit 1 | sort by (receivedAt, requestId) offset 0 limit 20`,
      );
    });

    it('newest first: fills a page from Postgres, then continues into the archive', async () => {
      stored = [summary(3, 30), summary(4, 40)];
      archived = [summary(1, 10), summary(2, 20)];

      const first = await service.list(query({ limit: 3 }));
      const second = await service.list(query({ limit: 3, page: 2 }));

      expect(ids(first.items)).toEqual([uuidOf(4), uuidOf(3), uuidOf(2)]);
      expect(ids(second.items)).toEqual([uuidOf(1)]);
      expect(first.meta.total).toBe(4);
    });

    it('oldest first: the archive comes first and Postgres continues it', async () => {
      stored = [summary(3, 30), summary(4, 40)];
      archived = [summary(1, 10), summary(2, 20)];

      const page = await service.list(
        query({ sortOrder: SortOrder.Asc, limit: 3 }),
      );

      expect(ids(page.items)).toEqual([uuidOf(1), uuidOf(2), uuidOf(3)]);
    });

    it('converts an archived line back into a summary', async () => {
      stored = [summary(3, 30)];
      archived = [
        summary(1, 10, {
          amountFiat: toFiat('2000.5'),
          requestedBankId: 7,
          errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
          result: MerchantRequestResult.NotCreated,
          statusCode: 403,
        }),
      ];

      const page = await service.list(query());
      const line = page.items[1];

      expect({ ...line, amountFiat: formatFiat(line.amountFiat!) }).toEqual({
        ...archived[0],
        amountFiat: '2000.50',
      });
    });

    it('merges an amount sort across both stores, empties last in desc', async () => {
      stored = [
        summary(3, 30, { amountFiat: toFiat(300) }),
        summary(4, 40, { amountFiat: null }),
      ];
      archived = [
        summary(1, 10, { amountFiat: toFiat(900) }),
        summary(2, 20, { amountFiat: toFiat(100) }),
        summary(5, 5, { amountFiat: null }),
      ];

      const desc = await service.list(
        query({ sortBy: MerchantRequestSortField.Amount }),
      );
      const second = await service.list(
        query({ sortBy: MerchantRequestSortField.Amount, limit: 2, page: 2 }),
      );
      const asc = await service.list(
        query({
          sortBy: MerchantRequestSortField.Amount,
          sortOrder: SortOrder.Asc,
        }),
      );

      expect(ids(desc.items)).toEqual([
        uuidOf(1),
        uuidOf(3),
        uuidOf(2),
        uuidOf(4),
        uuidOf(5),
      ]);
      expect(ids(second.items)).toEqual([uuidOf(2), uuidOf(4)]);
      expect(ids(asc.items)).toEqual([
        uuidOf(5),
        uuidOf(4),
        uuidOf(2),
        uuidOf(3),
        uuidOf(1),
      ]);
      expect(desc.meta.total).toBe(5);
    });

    it('walks merchants by name across both stores', async () => {
      stored = [
        summary(3, 30, { merchantId: MERCHANT_A }),
        summary(4, 40, { merchantId: MERCHANT_B }),
      ];
      archived = [
        summary(1, 10, { merchantId: MERCHANT_B }),
        summary(2, 20, { merchantId: MERCHANT_A }),
      ];

      const page = await service.list(
        query({
          sortBy: MerchantRequestSortField.Merchant,
          sortOrder: SortOrder.Asc,
          merchantRanks: new Map([
            [MERCHANT_A, 0],
            [MERCHANT_B, 1],
          ]),
        }),
      );

      expect(ids(page.items)).toEqual([
        uuidOf(2),
        uuidOf(3),
        uuidOf(1),
        uuidOf(4),
      ]);
      expect(page.meta.total).toBe(4);
    });

    it('sums the tab counters of both stores', async () => {
      stored = [
        summary(3, 30),
        summary(4, 40, { result: MerchantRequestResult.NotCreated }),
      ];
      archived = [
        summary(1, 10),
        summary(2, 20, {
          result: MerchantRequestResult.Error,
          operation: null,
        }),
      ];

      expect(await service.counters({})).toEqual({
        all: 4,
        created: 2,
        notCreated: 1,
      });
    });

    it('exports from both stores, newest first', async () => {
      stored = [summary(3, 30)];
      archived = [summary(1, 10), summary(2, 20)];

      expect(ids(await service.export({}, 10))).toEqual([
        uuidOf(3),
        uuidOf(2),
        uuidOf(1),
      ]);
      await expect(service.export({}, 2)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reads a row missing from Postgres out of the archive, headers and summary parsed', async () => {
      victoria.selectScoped.mockResolvedValueOnce([
        {
          ...lineOf(summary(1, 10)),
          apiKeyId: '3',
          method: 'POST',
          path: '/v1/payment/pay-in',
          ip: '203.0.113.7',
          requestHeaders: '{"x-secure-key":"abcd…wxyz"}',
          requestBody: '{"amount":2000}',
          requestBodyTruncated: 'true',
          responseBody: '',
          responseBodyTruncated: 'false',
          selectionSummary: '{"considered":2}',
        },
      ]);

      const record = await service.findById(uuidOf(1));

      expect(victoria.selectScoped).toHaveBeenCalledWith(
        `source:="merchant_api" requestId:="${uuidOf(1)}" | limit 1`,
      );
      expect(record).toMatchObject({
        id: uuidOf(1),
        apiKeyId: 3,
        method: 'POST',
        ip: '203.0.113.7',
        requestHeaders: { 'x-secure-key': 'abcd…wxyz' },
        requestBody: '{"amount":2000}',
        requestBodyTruncated: true,
        responseBody: null,
        responseBodyTruncated: false,
        selectionSummary: { considered: 2 },
      });
      victoria.selectScoped.mockResolvedValueOnce([]);
      expect(await service.findById(uuidOf(2))).toBeNull();
    });

    it('answers 503 rather than a partial list when the archive cannot be read', async () => {
      archived = [summary(1, 10)];
      victoria.selectScoped.mockRejectedValue(new Error('down'));

      await expect(service.list(query())).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(service.findById(uuidOf(1))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
