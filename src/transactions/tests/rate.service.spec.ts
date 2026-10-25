import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import { Fiat } from '../../common/types/fiat';
import { toRate } from '../../common/utils/to-rate';
import { toFiat } from '../../common/utils/to-fiat';
import { AuditService } from '../../audit/services/audit.service';
import { BanksService } from '../../banks/banks.service';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { LeadRate } from '../entities/lead-rate.entity';
import { MethodRate } from '../entities/method-rate.entity';
import { RapiraRateProvider } from '../services/rapira-rate.provider';
import { RateService } from '../services/rate.service';
import { RateScope } from '../types/rate-scope.enum';
import { SubjectMethodRates } from '../types/rate-set';
import { TransactionMethod } from '../types/transaction-method';

jest.mock('../utils/find-transaction-method', () => {
  const actual = jest.requireActual<
    typeof import('../utils/find-transaction-method')
  >('../utils/find-transaction-method');

  return {
    findTransactionMethod: (code: string) =>
      code.startsWith('mono_bank')
        ? { code, currency: 'RUB', rateKind: 'by_bank' }
        : actual.findTransactionMethod(code),
  };
});

const BY_BANK = 'mono_bank' as TransactionMethod;

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
      bankId: null,
    }) as MethodRate;

  const baseRows = [row('sbp', 10, 3), row('card', 12, 4)];

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
        {
          provide: getRepositoryToken(LeadRate),
          useValue: { find: jest.fn() },
        },
        { provide: getDataSourceToken(), useValue: {} },
        { provide: RapiraRateProvider, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: BanksService, useValue: {} },
      ],
    }).compile();

    service = module.get(RateService);
  });

  it('gives the base set to a subject with individual rates disabled', async () => {
    resolveWith(baseRows, [row('sbp', 1, 1, uuidOf(1))]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: false },
    ]);

    expect(result.base).toHaveLength(2);
    expect(result.bySubject.get(uuidOf(1))).toEqual(result.base);
    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it('overrides one method and keeps the base for the others', async () => {
    resolveWith(baseRows, [row('sbp', 8, 2, uuidOf(1))]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
      { userId: uuidOf(2), individualEnabled: true },
    ]);

    expect(result.bySubject.get(uuidOf(1))).toEqual([
      { method: 'sbp', payInPercent: 8, payOutPercent: 2 },
      { method: 'card', payInPercent: 12, payOutPercent: 4 },
    ]);
    expect(result.bySubject.get(uuidOf(2))).toEqual(result.base);
    expect(repository.find).toHaveBeenCalledTimes(2);
  });

  it('includes a method that exists only as an individual rate', async () => {
    resolveWith(baseRows, [row('mobile_commerce', 5, 1, uuidOf(1))]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
    ]);

    expect(
      result.bySubject.get(uuidOf(1)).map((entry) => entry.method),
    ).toEqual(['sbp', 'card', 'mobile_commerce']);
  });

  it('orders base and subject lists by method declaration whatever order the rows arrive in', async () => {
    resolveWith(
      [row('mobile_commerce', 7, 2), row('card', 12, 4), row('sbp', 10, 3)],
      [row('counterparty', 9, 1, uuidOf(1))],
    );

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, [
      { userId: uuidOf(1), individualEnabled: true },
    ]);

    const order = ['sbp', 'card', 'counterparty', 'mobile_commerce'];

    expect(result.base.map((entry) => entry.method)).toEqual(
      order.filter((method) => method !== 'counterparty'),
    );
    expect(
      result.bySubject.get(uuidOf(1)).map((entry) => entry.method),
    ).toEqual(order);
  });

  it('puts a stored code the registry no longer knows after every registered method', async () => {
    resolveWith([
      row('retired' as TransactionMethod, 1, 1),
      row('card', 12, 4),
      row('sbp', 10, 3),
    ]);

    const result = await service.getEffectiveGeneralRates(RateScope.Trader, []);

    expect(result.base.map((entry) => entry.method)).toEqual([
      'sbp',
      'card',
      'retired',
    ]);
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
    expect(where.bankId).toBeDefined();
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

describe('RateService rate sets', () => {
  const manager = {
    query: jest.fn<Promise<unknown[]>, [string, unknown[]]>(async () => []),
    delete: jest.fn(async () => undefined),
    create: jest.fn((_entity: unknown, data: Partial<MethodRate>) => data),
    save: jest.fn(async (rows: unknown) => rows),
  };
  const dataSource = {
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => unknown) => work(manager),
    ),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const banks = {
    findByIds: jest.fn(async (ids: number[]) =>
      ids.filter((id) => id < 100).map((id) => ({ id })),
    ),
  };
  const repository = { find: jest.fn() };
  const leadRepository = { find: jest.fn() };
  const actor = { actorUserId: uuidOf(9) };
  const percent = { payInPercent: 5, payOutPercent: 2 };

  const service = new RateService(
    repository as never,
    leadRepository as never,
    dataSource as never,
    {} as never,
    {} as never,
    audit as never,
    banks as never,
  );

  const entry = (
    overrides: Partial<SubjectMethodRates> = {},
  ): SubjectMethodRates => ({
    method: 'sbp',
    general: percent,
    bands: [],
    banks: [],
    ...overrides,
  });

  const replace = (entries: SubjectMethodRates[]) =>
    service.replaceSubjectSet(RateScope.Trader, uuidOf(1), entries, actor);

  const savedRows = () =>
    (manager.save.mock.calls[0] as unknown as [Partial<MethodRate>[]])[0];

  beforeEach(() => jest.clearAllMocks());

  describe('replaceSubjectSet', () => {
    it('refuses a method the registry does not know', async () => {
      await expect(
        replace([entry({ method: 'qr' as TransactionMethod })]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses bank rows on a method priced by amount', async () => {
      await expect(
        replace([entry({ banks: [{ bankId: 1, ...percent }] })]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses amount bands on a method priced by bank', async () => {
      await expect(
        replace([
          entry({
            method: BY_BANK,
            bands: [
              { fromAmount: toFiat(0), toAmount: toFiat(100), ...percent },
            ],
          }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses overlapping bands', async () => {
      await expect(
        replace([
          entry({
            bands: [
              { fromAmount: toFiat(0), toAmount: toFiat(100), ...percent },
              { fromAmount: toFiat(100), toAmount: toFiat(200), ...percent },
            ],
          }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a gap between bands', async () => {
      await replace([
        entry({
          bands: [
            { fromAmount: toFiat(0), toAmount: toFiat(100), ...percent },
            { fromAmount: toFiat(500), toAmount: toFiat(900), ...percent },
          ],
        }),
      ]);

      expect(savedRows()).toHaveLength(3);
    });

    it('refuses two rows for the same bank within one method', async () => {
      await expect(
        replace([
          entry({
            method: BY_BANK,
            banks: [
              { bankId: 1, ...percent },
              { bankId: 1, payInPercent: 7, payOutPercent: 3 },
            ],
          }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses a bank nobody holds', async () => {
      await expect(
        replace([
          entry({
            method: BY_BANK,
            banks: [
              { bankId: 1, ...percent },
              { bankId: 404, ...percent },
            ],
          }),
        ]),
      ).rejects.toThrow('Bank 404 does not exist');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('asks for every referenced bank in one query', async () => {
      await replace([
        entry({
          method: BY_BANK,
          banks: [
            { bankId: 1, ...percent },
            { bankId: 2, ...percent },
          ],
        }),
      ]);

      expect(banks.findByIds).toHaveBeenCalledTimes(1);
      expect(banks.findByIds).toHaveBeenCalledWith([1, 2]);
    });

    it('stores the general rate and one row per bank for a method priced by bank', async () => {
      await replace([
        entry({
          method: BY_BANK,
          banks: [
            { bankId: 1, payInPercent: 7, payOutPercent: 3 },
            { bankId: 2, payInPercent: 6, payOutPercent: 1 },
          ],
        }),
      ]);

      expect(savedRows()).toEqual([
        expect.objectContaining({
          method: BY_BANK,
          bankId: null,
          fromAmount: null,
          toAmount: null,
          payInPercent: 5,
        }),
        expect.objectContaining({
          bankId: 1,
          fromAmount: null,
          toAmount: null,
          payInPercent: 7,
          payOutPercent: 3,
        }),
        expect.objectContaining({ bankId: 2, payInPercent: 6 }),
      ]);
    });

    it('stores bands without a bank for a method priced by amount', async () => {
      await replace([
        entry({
          bands: [{ fromAmount: toFiat(0), toAmount: toFiat(100), ...percent }],
        }),
      ]);

      expect(savedRows()[1]).toEqual(
        expect.objectContaining({
          fromAmount: toFiat(0),
          toAmount: toFiat(100),
          bankId: null,
        }),
      );
    });

    it('lets the same bank appear under two different methods', async () => {
      await replace([
        entry({ method: BY_BANK, banks: [{ bankId: 1, ...percent }] }),
        entry({
          method: 'mono_bank_two' as TransactionMethod,
          banks: [{ bankId: 1, ...percent }],
        }),
      ]);

      expect(banks.findByIds).toHaveBeenCalledWith([1]);
      expect(savedRows().filter((row) => row.bankId === 1)).toHaveLength(2);
    });

    it('writes the rates.updated audit row in the same transaction', async () => {
      await replace([entry()]);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rates.updated',
          targetUserId: uuidOf(1),
        }),
        manager,
      );
    });
  });

  describe('the same method twice in one set', () => {
    it('is a 400 on a base set', async () => {
      await expect(
        service.replaceBaseSet(
          RateScope.Trader,
          [
            { method: 'sbp', ...percent },
            { method: 'sbp', payInPercent: 1, payOutPercent: 1 },
          ],
          actor,
        ),
      ).rejects.toThrow(/sbp appears more than once/);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('is a 400 on an individual set', async () => {
      await expect(
        replace([entry(), entry({ general: null })]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('is a 400 on a lead detail set', async () => {
      await expect(
        service.replaceLeadSet(
          [link()],
          [entry(), entry({ general: null })],
          leadAudit,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('lets two different methods through', async () => {
      await replace([entry(), entry({ method: 'card' })]);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  const link = (overrides: Partial<TraderLead> = {}): TraderLead =>
    ({
      id: 70,
      traderUserId: uuidOf(1),
      leadUserId: uuidOf(2),
      currencyId: 1,
      currency: { id: 1, isocode: 'RUB' },
      payInPercent: 2.5,
      payOutPercent: 0.5,
      ...overrides,
    }) as TraderLead;

  const leadAudit = {
    actorUserId: uuidOf(9),
    traderUserId: uuidOf(1),
    leadUserId: uuidOf(2),
  };

  describe('replaceLeadSet', () => {
    it('attaches every row to the assignment in the method currency, with the audit in the same transaction', async () => {
      await service.replaceLeadSet(
        [
          link({ id: 71, currency: { id: 2, isocode: 'KZT' } as never }),
          link(),
        ],
        [
          entry({
            bands: [
              {
                fromAmount: toFiat(1000),
                toAmount: toFiat(5000),
                payInPercent: 1,
                payOutPercent: 0.2,
              },
            ],
          }),
        ],
        leadAudit,
      );

      expect(manager.delete).toHaveBeenCalledWith(LeadRate, {
        traderLeadId: expect.objectContaining({ type: 'in', value: [71, 70] }),
      });
      expect(savedRows()).toEqual([
        expect.objectContaining({
          traderLeadId: 70,
          method: 'sbp',
          fromAmount: null,
          toAmount: null,
          bankId: null,
          ...percent,
        }),
        expect.objectContaining({
          traderLeadId: 70,
          fromAmount: toFiat(1000),
          toAmount: toFiat(5000),
          payInPercent: 1,
          payOutPercent: 0.2,
        }),
      ]);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: uuidOf(9),
          targetUserId: uuidOf(1),
          action: 'lead_rates.updated',
          metadata: { leadUserId: uuidOf(2) },
        },
        manager,
      );
    });

    it('stores bank rows on a method priced by bank', async () => {
      await service.replaceLeadSet(
        [link()],
        [entry({ method: BY_BANK, banks: [{ bankId: 3, ...percent }] })],
        leadAudit,
      );

      expect(savedRows()).toContainEqual(
        expect.objectContaining({
          traderLeadId: 70,
          bankId: 3,
          fromAmount: null,
        }),
      );
    });

    it('answers 400 to a method whose currency the lead has no assignment in', async () => {
      await expect(
        service.replaceLeadSet(
          [link({ currency: { id: 2, isocode: 'KZT' } as never })],
          [entry()],
          leadAudit,
        ),
      ).rejects.toThrow(/in RUB/);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each([
      [
        'bank rows on a method priced by amount',
        entry({ banks: [{ bankId: 1, ...percent }] }),
      ],
      [
        'bands on a method priced by bank',
        entry({
          method: BY_BANK,
          bands: [{ fromAmount: toFiat(0), toAmount: toFiat(1), ...percent }],
        }),
      ],
      [
        'overlapping bands',
        entry({
          bands: [
            { fromAmount: toFiat(0), toAmount: toFiat(100), ...percent },
            { fromAmount: toFiat(50), toAmount: toFiat(200), ...percent },
          ],
        }),
      ],
      [
        'a bank nobody holds',
        entry({ method: BY_BANK, banks: [{ bankId: 500, ...percent }] }),
      ],
    ])('answers 400 to %s, like a trader set', async (_name, invalid) => {
      await expect(
        service.replaceLeadSet([link()], [invalid], leadAudit),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('accepts a gap between bands', async () => {
      await service.replaceLeadSet(
        [link()],
        [
          entry({
            bands: [
              { fromAmount: toFiat(0), toAmount: toFiat(100), ...percent },
              { fromAmount: toFiat(500), toAmount: toFiat(900), ...percent },
            ],
          }),
        ],
        leadAudit,
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('takes an empty set as clearing the detail and leaving the currency general rate', async () => {
      await service.replaceLeadSet([link()], [], leadAudit);

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('getLeadSet', () => {
    it('asks nothing for no assignment', async () => {
      await expect(service.getLeadSet([])).resolves.toEqual([]);
      expect(leadRepository.find).not.toHaveBeenCalled();
    });

    it('reads every assignment in one query', async () => {
      leadRepository.find.mockResolvedValue([]);

      await service.getLeadSet([70, 71]);

      expect(leadRepository.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveLeadPercents', () => {
    const detail = (overrides: Partial<LeadRate>): LeadRate =>
      ({
        traderLeadId: 70,
        method: 'sbp',
        fromAmount: null,
        toAmount: null,
        bankId: null,
        payInPercent: 2,
        payOutPercent: 0.4,
        ...overrides,
      }) as LeadRate;

    const resolve = (
      method: TransactionMethod,
      overrides: {
        amount?: Fiat;
        bankId?: number | null;
        direction?: 'payIn' | 'payOut';
      } = {},
      links: TraderLead[] = [link()],
    ) =>
      service.resolveLeadPercents({
        links,
        method,
        amount: overrides.amount ?? toFiat(2000),
        bankId: overrides.bankId ?? null,
        direction: overrides.direction ?? 'payIn',
      });

    it('takes the band containing the amount first', async () => {
      leadRepository.find.mockResolvedValue([
        detail({}),
        detail({
          fromAmount: toFiat(1000),
          toAmount: toFiat(5000),
          payInPercent: 1.5,
        }),
      ]);

      await expect(resolve('sbp')).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 1.5 },
      ]);
    });

    it('falls back to the method general rate outside every band', async () => {
      leadRepository.find.mockResolvedValue([
        detail({}),
        detail({
          fromAmount: toFiat(1000),
          toAmount: toFiat(5000),
          payInPercent: 1.5,
        }),
      ]);

      await expect(resolve('sbp', { amount: toFiat(9000) })).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 2 },
      ]);
    });

    it('falls back to the currency general rate from the assignment when the method has no detail', async () => {
      leadRepository.find.mockResolvedValue([]);

      await expect(resolve('sbp')).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 2.5 },
      ]);
      await expect(resolve('sbp', { direction: 'payOut' })).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 0.5 },
      ]);
    });

    it('takes the bank row of the deal bank on a method priced by bank, then the general rates', async () => {
      leadRepository.find.mockResolvedValue([
        detail({ method: BY_BANK, bankId: 3, payInPercent: 1.1 }),
      ]);

      await expect(resolve(BY_BANK, { bankId: 3 })).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 1.1 },
      ]);
      await expect(resolve(BY_BANK, { bankId: 4 })).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 2.5 },
      ]);
    });

    it('resolves every lead in one query, each from its own rows', async () => {
      leadRepository.find.mockResolvedValue([
        detail({ traderLeadId: 71, payInPercent: 0.7 }),
      ]);

      await expect(
        resolve('sbp', {}, [
          link(),
          link({ id: 71, leadUserId: uuidOf(3), payInPercent: 1 }),
        ]),
      ).resolves.toEqual([
        { leadUserId: uuidOf(2), percent: 2.5 },
        { leadUserId: uuidOf(3), percent: 0.7 },
      ]);
      expect(leadRepository.find).toHaveBeenCalledTimes(1);
    });

    it('ignores an assignment in another currency and asks nothing when none is left', async () => {
      await expect(
        resolve('sbp', {}, [
          link({ currency: { id: 2, isocode: 'KZT' } as never }),
        ]),
      ).resolves.toEqual([]);
      expect(leadRepository.find).not.toHaveBeenCalled();
    });

    it('refuses a method the registry does not know', async () => {
      await expect(resolve('qr' as TransactionMethod)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('replaceBaseSet', () => {
    it('refuses a method the registry does not know', async () => {
      await expect(
        service.replaceBaseSet(
          RateScope.Trader,
          [{ method: 'qr' as TransactionMethod, ...percent }],
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('stores only general rows, with no band and no bank', async () => {
      await service.replaceBaseSet(
        RateScope.Trader,
        [{ method: 'sbp', ...percent }],
        actor,
      );

      expect(savedRows()).toEqual([
        expect.objectContaining({
          method: 'sbp',
          subjectUserId: null,
          bankId: null,
          fromAmount: null,
          toAmount: null,
        }),
      ]);
    });
  });

  describe('serialising concurrent replacements', () => {
    const ADVISORY_LOCK = 'SELECT pg_advisory_xact_lock(hashtext($1))';

    const firstStatement = () => {
      const order = (mock: jest.Mock) =>
        mock.mock.invocationCallOrder[0] ?? Infinity;
      const first = Math.min(
        order(manager.query),
        order(manager.delete),
        order(manager.save),
        order(audit.record),
      );

      return first === order(manager.query)
        ? manager.query.mock.calls[0]
        : null;
    };

    it('takes an advisory lock on the scope and subject before anything else', async () => {
      await replace([entry()]);

      expect(firstStatement()).toEqual([
        ADVISORY_LOCK,
        [`method_rates:${RateScope.Trader}:${uuidOf(1)}`],
      ]);
    });

    it('takes an advisory lock on the scope base set before anything else', async () => {
      await service.replaceBaseSet(
        RateScope.Trader,
        [{ method: 'sbp', ...percent }],
        actor,
      );

      expect(firstStatement()).toEqual([
        ADVISORY_LOCK,
        [`method_rates:${RateScope.Trader}:base`],
      ]);
    });

    it('takes an advisory lock on the trader and lead pair before anything else', async () => {
      await service.replaceLeadSet([link()], [entry()], leadAudit);

      expect(firstStatement()).toEqual([
        ADVISORY_LOCK,
        [`lead_rates:${uuidOf(1)}:${uuidOf(2)}`],
      ]);
    });
  });

  describe('getBaseSet', () => {
    it('reads general rows only', async () => {
      repository.find.mockResolvedValue([]);

      await service.getBaseSet(RateScope.Trader);

      const [{ where }] = repository.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];

      expect(Object.keys(where)).toEqual(
        expect.arrayContaining(['fromAmount', 'toAmount', 'bankId']),
      );
    });
  });

  describe('resolveMethodPercent', () => {
    const rate = (
      overrides: Partial<MethodRate>,
      subjectUserId: string | null = uuidOf(1),
    ): MethodRate =>
      ({
        subjectUserId,
        subjectMerchantId: null,
        fromAmount: null,
        toAmount: null,
        bankId: null,
        payInPercent: 10,
        payOutPercent: 3,
        ...overrides,
      }) as MethodRate;

    const query = (method: TransactionMethod, bankId: number | null) =>
      service.resolveMethodPercent({
        scope: RateScope.Trader,
        method,
        amount: toFiat(2000),
        bankId,
        direction: 'payIn',
        individualEnabled: true,
        subjectUserId: uuidOf(1),
      });

    it('takes the individual row of the deal bank for a method priced by bank', async () => {
      repository.find.mockResolvedValue([
        rate({}, null),
        rate({ payInPercent: 8 }),
        rate({ bankId: 1, payInPercent: 6 }),
      ]);

      await expect(query(BY_BANK, 1)).resolves.toBe(6);
    });

    it('falls back to the individual general rate when the deal bank has no row', async () => {
      repository.find.mockResolvedValue([
        rate({}, null),
        rate({ payInPercent: 8 }),
        rate({ bankId: 1, payInPercent: 6 }),
      ]);

      await expect(query(BY_BANK, 2)).resolves.toBe(8);
    });

    it('falls back to the base general rate when the subject has nothing that applies', async () => {
      repository.find.mockResolvedValue([
        rate({}, null),
        rate({ bankId: 1, payInPercent: 6 }),
      ]);

      await expect(query(BY_BANK, 2)).resolves.toBe(10);
    });

    it('keeps resolving bands for a method priced by amount', async () => {
      repository.find.mockResolvedValue([
        rate({}, null),
        rate({ payInPercent: 8 }),
        rate({
          fromAmount: toFiat(1000),
          toAmount: toFiat(5000),
          payInPercent: 4,
        }),
      ]);

      await expect(query('sbp', null)).resolves.toBe(4);
    });

    it('refuses a method the registry does not know', async () => {
      await expect(
        query('qr' as TransactionMethod, null),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.find).not.toHaveBeenCalled();
    });
  });
});

describe('RateService.getBaseRate', () => {
  it('applies the markup to the Rapira rate exactly, to six decimals', async () => {
    const service = new RateService(
      {} as never,
      {} as never,
      {} as never,
      { getFiatPerUsdt: jest.fn(async () => toRate('88.92')) } as never,
      { get: jest.fn(() => 0.01) } as never,
      {} as never,
      {} as never,
    );

    await expect(service.getBaseRate()).resolves.toEqual(toRate('89.8092'));
  });
});
