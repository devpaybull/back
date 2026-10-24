import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../../audit/audit.service';
import { FindOperator } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MethodRate } from '../entities/method-rate.entity';
import { RapiraRateProvider } from '../services/rapira-rate.provider';
import { RateService } from '../services/rate.service';
import { RateScope } from '../types/rate-scope.enum';
import { TransactionMethod } from '../types/transaction-method.enum';

describe('RateService.getEffectiveGeneralRates', () => {
  const repository = { find: jest.fn() };

  const row = (
    method: TransactionMethod,
    payInPercent: number,
    payOutPercent: number,
    subjectUserId: string | null = null,
  ): MethodRate =>
    ({
      method,
      payInPercent,
      payOutPercent,
      subjectUserId,
      fromAmount: null,
      toAmount: null,
    }) as MethodRate;

  const baseRows = [
    row(TransactionMethod.Sbp, 10, 3),
    row(TransactionMethod.Card, 12, 4),
  ];

  let service: RateService;

  const resolveWith = (base: MethodRate[], individual: MethodRate[] = []) =>
    repository.find.mockImplementation(
      async ({ where }: { where: { subjectUserId: unknown } }) =>
        (where.subjectUserId as FindOperator<string>).type === 'in'
          ? individual
          : base,
    );

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        RateService,
        { provide: getRepositoryToken(MethodRate), useValue: repository },
        { provide: getDataSourceToken(), useValue: {} },
        { provide: RapiraRateProvider, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    service = module.get(RateService);
  });

  it('gives the base set to a subject with individual rates disabled', async () => {
    resolveWith(baseRows, [row(TransactionMethod.Sbp, 1, 1, uuidOf(1))]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: false },
    ]);

    expect(result.base).toHaveLength(2);
    expect(result.bySubject.get(uuidOf(1))).toEqual(result.base);
    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it('overrides one method and keeps the base for the others', async () => {
    resolveWith(baseRows, [row(TransactionMethod.Sbp, 8, 2, uuidOf(1))]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
      { userId: uuidOf(2), individualEnabled: true },
    ]);

    expect(result.bySubject.get(uuidOf(1))).toEqual([
      { method: TransactionMethod.Sbp, payInPercent: 8, payOutPercent: 2 },
      { method: TransactionMethod.Card, payInPercent: 12, payOutPercent: 4 },
    ]);
    expect(result.bySubject.get(uuidOf(2))).toEqual(result.base);
    expect(repository.find).toHaveBeenCalledTimes(2);
  });

  it('includes a method that exists only as an individual rate', async () => {
    resolveWith(baseRows, [
      row(TransactionMethod.MobileCommerce, 5, 1, uuidOf(1)),
    ]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
    ]);

    expect(
      result.bySubject.get(uuidOf(1)).map((entry) => entry.method),
    ).toEqual([
      TransactionMethod.Sbp,
      TransactionMethod.Card,
      TransactionMethod.MobileCommerce,
    ]);
  });

  it('orders base and subject lists by method declaration whatever order the rows arrive in', async () => {
    resolveWith(
      [
        row(TransactionMethod.MobileCommerce, 7, 2),
        row(TransactionMethod.Card, 12, 4),
        row(TransactionMethod.Sbp, 10, 3),
      ],
      [row(TransactionMethod.Counterparty, 9, 1, uuidOf(1))],
    );

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
    ]);

    const order = [
      TransactionMethod.Sbp,
      TransactionMethod.Card,
      TransactionMethod.Counterparty,
      TransactionMethod.MobileCommerce,
    ];

    expect(result.base.map((entry) => entry.method)).toEqual(
      order.filter((method) => method !== TransactionMethod.Counterparty),
    );
    expect(
      result.bySubject.get(uuidOf(1)).map((entry) => entry.method),
    ).toEqual(order);
  });

  it('gives an enabled subject without individual rows exactly the base', async () => {
    resolveWith(baseRows, []);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
    ]);

    expect(result.bySubject.get(uuidOf(1))).toEqual(result.base);
  });

  it('asks the individual query only for subjects with it enabled and only for general rows', async () => {
    resolveWith(baseRows);

    await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
      { userId: uuidOf(2), individualEnabled: false },
    ]);

    const { where } = repository.find.mock.calls[1][0] as {
      where: Record<string, { value: unknown }>;
    };

    expect(where.subjectUserId.value).toEqual([uuidOf(1)]);
    expect(where.fromAmount).toBeDefined();
    expect(where.toAmount).toBeDefined();
  });

  it('runs a single query when there are no subjects', async () => {
    resolveWith(baseRows);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, []);

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(result.bySubject.size).toBe(0);
    expect(result.base).toHaveLength(2);
  });

  it('runs a single query when nobody has individual rates enabled', async () => {
    resolveWith(baseRows);

    await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: false },
    ]);

    expect(repository.find).toHaveBeenCalledTimes(1);
  });
});
