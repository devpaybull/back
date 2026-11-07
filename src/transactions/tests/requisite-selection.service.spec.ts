import { ConflictException } from '@nestjs/common';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { RequisiteCandidate } from '../../bank-details/types/requisite-candidate';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Crypto } from '../../common/types/crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { CounterpartyBindingType } from '../../counterparties/types/counterparty-binding-type.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { CandidateRejectedError } from '../exceptions/candidate-rejected.exception';
import { NoRequisiteFoundError } from '../exceptions/no-requisite-found.exception';
import { AttachedFirstRanking } from '../services/attached-first-ranking.service';
import { RequisiteSelectionService } from '../services/requisite-selection.service';
import { DealIssueHooks } from '../types/deal-issue-hooks';
import { IssuedDealInput } from '../types/issued-deal-input';
import { RequisiteIssueUsage } from '../types/requisite-issue-usage';
import { SelectionCandidate } from '../types/selection-candidate';
import { SelectionFilter } from '../types/selection-filter.enum';
import { SelectionOutcome } from '../types/selection-outcome.enum';
import { SelectionRequest } from '../types/selection-request';
import { SkippedCandidate } from '../types/skipped-candidate';

const NOW = new Date('2026-11-04T12:00:00Z');
const MERCHANT = uuidOf(900);
const VICTIM = uuidOf(1);
const HEALTHY = uuidOf(2);
const THIRD = uuidOf(3);
const REQ_VICTIM = uuidOf(101);
const REQ_HEALTHY = uuidOf(102);
const REQ_THIRD = uuidOf(103);

const requisite = (
  id: string,
  userId: string,
  overrides: Partial<RequisiteCandidate> = {},
): RequisiteCandidate => ({
  id,
  userId,
  type: BankDetailsType.CardOrSbp,
  bankId: 1,
  bankCurrency: 'RUB',
  mobileOperatorId: null,
  card: null,
  phone: '+79010000000',
  deviceId: 1,
  deviceOnline: true,
  active: true,
  banned: false,
  counterpartyOnly: false,
  reserve: false,
  sameBankOnly: false,
  maxCounterparties: null,
  minAmount: null,
  maxAmount: null,
  dailyLimit: null,
  monthlyLimit: null,
  dailyAmountLimit: toFiat(100000),
  monthlyAmountLimit: null,
  hourlyAmountLimit: null,
  maxActiveTransactions: null,
  delayBetweenRequestsSeconds: null,
  ...overrides,
});

const freshUsage = (
  overrides: Partial<RequisiteIssueUsage> = {},
): RequisiteIssueUsage => ({
  dealsToday: 0,
  dealsMonth: 0,
  amountToday: toFiat(0),
  amountMonth: toFiat(0),
  amountLastHour: toFiat(0),
  openDeals: 0,
  openWithSameAmount: false,
  lastDealAt: null,
  ...overrides,
});

interface Wallet {
  userId: string;
  mainBalance: Crypto;
  mainReserved: Crypto;
  insurancePayInBalance: Crypto;
}

interface Scenario {
  requisites: RequisiteCandidate[];
  usage: Map<string, RequisiteIssueUsage>;
  lockedUsage: Map<string, RequisiteIssueUsage>;
  locked: Map<string, RequisiteCandidate | null>;
  exclusiveTopUp: boolean;
  attached: Set<string>;
  switchedOff: Set<string>;
  statuses: Map<string, UserStatus>;
  tradingOff: Set<string>;
  threshold?: number;
  nightStopped: Set<string>;
  wallets: Map<string, Wallet>;
  percents: Map<string, number | null>;
  counterparty: { id: number; bankDetailsId: string | null } | null;
  boundCounts: Map<string, number>;
  bindConflict: boolean;
  escrowConflict: Set<string>;
}

const wallet = (userId: string, overrides: Partial<Wallet> = {}): Wallet => ({
  userId,
  mainBalance: toCrypto(1000),
  mainReserved: toCrypto(0),
  insurancePayInBalance: toCrypto(500),
  ...overrides,
});

const scenarioOf = (overrides: Partial<Scenario> = {}): Scenario => ({
  requisites: [requisite(REQ_VICTIM, VICTIM), requisite(REQ_HEALTHY, HEALTHY)],
  usage: new Map(),
  lockedUsage: new Map(),
  locked: new Map(),
  exclusiveTopUp: false,
  attached: new Set(),
  switchedOff: new Set(),
  statuses: new Map(),
  tradingOff: new Set(),
  nightStopped: new Set(),
  wallets: new Map([
    [VICTIM, wallet(VICTIM)],
    [HEALTHY, wallet(HEALTHY)],
    [THIRD, wallet(THIRD)],
  ]),
  percents: new Map(),
  counterparty: null,
  boundCounts: new Map(),
  bindConflict: false,
  escrowConflict: new Set(),
  ...overrides,
});

const build = (scenario: Scenario) => {
  const manager = { marker: 'manager' };
  const attempts = {
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (rows: unknown) => rows),
  };
  const bankDetails = {
    findCandidates: jest.fn(async () => scenario.requisites),
    lockCandidateWithin: jest.fn(async (_manager: unknown, id: string) =>
      scenario.locked.has(id)
        ? scenario.locked.get(id)
        : scenario.requisites.find((row) => row.id === id),
    ),
  };
  const attachments = {
    admissionOf: jest.fn(async () => ({
      exclusiveTopUp: scenario.exclusiveTopUp,
      attachedTraderIds: scenario.attached,
      switchedOffTraderIds: scenario.switchedOff,
    })),
  };
  const counterparties = {
    findById: jest.fn(async () => scenario.counterparty),
    countBoundByRequisites: jest.fn(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, scenario.boundCounts.get(id) ?? 0])),
    ),
    bindWithin: jest.fn(async () => {
      if (scenario.bindConflict) throw new ConflictException('full');
    }),
  };
  const directory = {
    findByIds: jest.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        status: scenario.statuses.get(id) ?? UserStatus.Active,
      })),
    ),
  };
  const traderSettings = {
    findByUserIds: jest.fn(async (ids: string[]) =>
      ids.map((userId) => ({
        userId,
        tradingEnabled: !scenario.tradingOff.has(userId),
        individualRatesEnabled: false,
        insurancePayInMin: null,
      })),
    ),
    insurancePayInMinOf: jest.fn(() => toCrypto(100)),
  };
  const nightStop = {
    nightStoppedAmong: jest.fn(async () => scenario.nightStopped),
  };
  const wallets = {
    findByUserIds: jest.fn(async (ids: string[]) =>
      ids.flatMap((id) =>
        scenario.wallets.has(id) ? [scenario.wallets.get(id)] : [],
      ),
    ),
    getAvailableMain: (row: Wallet) =>
      roundCrypto(row.mainBalance.minus(row.mainReserved)),
    hasTradingBalance: (row: Wallet) =>
      row.mainBalance.minus(row.mainReserved).gt(scenario.threshold ?? 0),
  };
  const rates = {
    resolveSubjectPercents: jest.fn(
      async (_query: unknown, subjects: { userId: string }[]) =>
        subjects.map((subject) =>
          scenario.percents.has(subject.userId)
            ? scenario.percents.get(subject.userId)
            : 7,
        ),
    ),
  };
  const turnover = {
    issueUsageOf: jest.fn(
      async (ids: string[], _amount: unknown, _now: Date, within?: unknown) =>
        new Map(
          ids.map((id) => [
            id,
            (within ? scenario.lockedUsage.get(id) : undefined) ??
              scenario.usage.get(id) ??
              freshUsage(),
          ]),
        ),
    ),
  };
  const transactions = {
    createIssuedDeal: jest.fn(
      async (
        input: IssuedDealInput,
        candidates: SelectionCandidate[],
        hooks: DealIssueHooks<SelectionCandidate>,
      ) => {
        const skipped: SkippedCandidate<SelectionCandidate>[] = [];

        for (const candidate of candidates) {
          try {
            await hooks.checkWithin(manager as never, candidate);
            if (scenario.escrowConflict.has(candidate.traderUserId)) {
              skipped.push({
                candidate,
                reason: SelectionFilter.InsufficientBalance,
              });
              continue;
            }
            const transaction = {
              id: `deal-${candidate.bankDetailsId}`,
              ...input,
              traderUserId: candidate.traderUserId,
              bankDetailsId: candidate.bankDetailsId,
            };
            await hooks.afterInsertWithin?.(
              manager as never,
              candidate,
              transaction as never,
            );

            return { transaction, candidate, skipped };
          } catch (error) {
            if (!(error instanceof CandidateRejectedError)) throw error;
            skipped.push({ candidate, reason: error.reason });
          }
        }

        return { transaction: null, candidate: null, skipped };
      },
    ),
  };

  const service = new RequisiteSelectionService(
    attempts as never,
    bankDetails as never,
    attachments as never,
    counterparties as never,
    directory as never,
    traderSettings as never,
    nightStop as never,
    wallets as never,
    rates as never,
    turnover as never,
    transactions as never,
    new AttachedFirstRanking(),
  );

  return {
    service,
    attempts,
    bankDetails,
    counterparties,
    transactions,
    manager,
  };
};

const request = (
  overrides: Partial<SelectionRequest> = {},
): SelectionRequest => ({
  requestId: uuidOf(777),
  merchantId: MERCHANT,
  method: 'sbp',
  amountFiat: toFiat(1000),
  rate: toRate(90),
  merchantPercent: 10,
  ...overrides,
});

const issuedTo = async (
  scenario: Scenario,
  overrides: Partial<SelectionRequest> = {},
) => {
  const built = build(scenario);
  const result = await built.service.issue(request(overrides), NOW);

  return { ...built, result };
};

const victimWith = (overrides: Partial<RequisiteCandidate>) =>
  scenarioOf({
    requisites: [
      requisite(REQ_VICTIM, VICTIM, overrides),
      requisite(REQ_HEALTHY, HEALTHY),
    ],
  });

const victimUsage = (overrides: Partial<RequisiteIssueUsage>) =>
  new Map([[REQ_VICTIM, freshUsage(overrides)]]);

const FILTER_CASES: [
  SelectionFilter,
  () => Scenario,
  Partial<SelectionRequest>?,
][] = [
  [SelectionFilter.RequisiteDisabled, () => victimWith({ active: false })],
  [SelectionFilter.RequisiteBanned, () => victimWith({ banned: true })],
  [SelectionFilter.DeviceOffline, () => victimWith({ deviceOnline: false })],
  [SelectionFilter.CurrencyMismatch, () => victimWith({ bankCurrency: 'KZT' })],
  [
    SelectionFilter.BankMismatch,
    () => victimWith({ bankId: 2 }),
    { requestedBankId: 1 },
  ],
  [
    SelectionFilter.OperatorMismatch,
    () =>
      scenarioOf({
        requisites: [
          requisite(REQ_VICTIM, VICTIM, { mobileOperatorId: 4 }),
          requisite(REQ_HEALTHY, HEALTHY, { mobileOperatorId: 5 }),
        ],
      }),
    { requestedOperatorId: 5 },
  ],
  [SelectionFilter.SameBankOnly, () => victimWith({ sameBankOnly: true })],
  [
    SelectionFilter.AmountBelowMinimum,
    () => victimWith({ minAmount: toFiat(5000) }),
  ],
  [
    SelectionFilter.AmountAboveMaximum,
    () => victimWith({ maxAmount: toFiat(999.99) }),
  ],
  [SelectionFilter.ReserveOnly, () => victimWith({ reserve: true })],
  [
    SelectionFilter.MerchantNotAdmitted,
    () => scenarioOf({ exclusiveTopUp: true, attached: new Set([HEALTHY]) }),
  ],
  [
    SelectionFilter.TraderNotActive,
    () => scenarioOf({ statuses: new Map([[VICTIM, UserStatus.Suspended]]) }),
  ],
  [
    SelectionFilter.TradingDisabled,
    () => scenarioOf({ tradingOff: new Set([VICTIM]) }),
  ],
  [
    SelectionFilter.NightStop,
    () => scenarioOf({ nightStopped: new Set([VICTIM]) }),
  ],
  [
    SelectionFilter.InsuranceBelowMinimum,
    () =>
      scenarioOf({
        wallets: new Map([
          [VICTIM, wallet(VICTIM, { insurancePayInBalance: toCrypto(99.99) })],
          [HEALTHY, wallet(HEALTHY)],
        ]),
      }),
  ],
  [
    SelectionFilter.BalanceBelowThreshold,
    () =>
      scenarioOf({
        wallets: new Map([
          [
            VICTIM,
            wallet(VICTIM, {
              mainBalance: toCrypto(1000),
              mainReserved: toCrypto(900),
            }),
          ],
          [HEALTHY, wallet(HEALTHY)],
        ]),
        threshold: 100,
      }),
  ],
  [
    SelectionFilter.TraderRateMissing,
    () => scenarioOf({ percents: new Map([[VICTIM, null]]) }),
  ],
  [
    SelectionFilter.InsufficientBalance,
    () =>
      scenarioOf({
        wallets: new Map([
          [
            VICTIM,
            wallet(VICTIM, {
              mainBalance: toCrypto(20),
              mainReserved: toCrypto(10),
            }),
          ],
          [HEALTHY, wallet(HEALTHY)],
        ]),
      }),
  ],
  [
    SelectionFilter.DailyCount,
    () => ({
      ...victimWith({ dailyLimit: 3 }),
      usage: victimUsage({ dealsToday: 3 }),
    }),
  ],
  [
    SelectionFilter.MonthlyCount,
    () => ({
      ...victimWith({ monthlyLimit: 30 }),
      usage: victimUsage({ dealsMonth: 30 }),
    }),
  ],
  [
    SelectionFilter.DailyAmount,
    () => ({
      ...victimWith({ dailyAmountLimit: toFiat(10000) }),
      usage: victimUsage({ amountToday: toFiat(9000.01) }),
    }),
  ],
  [
    SelectionFilter.MonthlyAmount,
    () => ({
      ...victimWith({ monthlyAmountLimit: toFiat(50000) }),
      usage: victimUsage({ amountMonth: toFiat(49500) }),
    }),
  ],
  [
    SelectionFilter.HourlyAmount,
    () => ({
      ...victimWith({ hourlyAmountLimit: toFiat(1500) }),
      usage: victimUsage({ amountLastHour: toFiat(600) }),
    }),
  ],
  [
    SelectionFilter.MaxActive,
    () => ({
      ...victimWith({ maxActiveTransactions: 1 }),
      usage: victimUsage({ openDeals: 1 }),
    }),
  ],
  [
    SelectionFilter.Delay,
    () => ({
      ...victimWith({ delayBetweenRequestsSeconds: 60 }),
      usage: victimUsage({ lastDealAt: new Date(NOW.getTime() - 59_000) }),
    }),
  ],
  [
    SelectionFilter.SameAmountActive,
    () => ({
      ...victimWith({}),
      usage: victimUsage({ openWithSameAmount: true }),
    }),
  ],
];

describe('RequisiteSelectionService', () => {
  describe('drops a candidate for each filter of AC-4.1', () => {
    it.each(FILTER_CASES)('%s', async (reason, scenario, overrides = {}) => {
      const { result } = await issuedTo(scenario(), overrides);

      expect(result.summary.dropped).toEqual({ [reason]: 1 });
      expect(result.transaction.bankDetailsId).toBe(REQ_HEALTHY);
      expect(result.summary).toMatchObject({
        considered: 2,
        attempted: 1,
        skippedUnderLock: {},
        issuedBankDetailsId: REQ_HEALTHY,
      });
    });

    it('lets the same requisite pass when nothing is wrong with it', async () => {
      const { result } = await issuedTo(scenarioOf());

      expect(result.summary.dropped).toEqual({});
      expect(result.summary.considered).toBe(2);
    });

    it('honours a limit exactly at its edge', async () => {
      const { result } = await issuedTo(
        {
          ...victimWith({
            dailyLimit: 3,
            dailyAmountLimit: toFiat(10000),
            delayBetweenRequestsSeconds: 60,
          }),
          usage: victimUsage({
            dealsToday: 2,
            amountToday: toFiat(9000),
            lastDealAt: new Date(NOW.getTime() - 60_000),
          }),
        },
        {},
      );

      expect(result.summary.dropped).toEqual({});
    });
  });

  it('asks the bank-details owner for the requisites the method maps to', async () => {
    const cases = [
      [
        'card',
        {
          type: BankDetailsType.CardOrSbp,
          counterpartyOnly: false,
          withCard: true,
        },
      ],
      [
        'sbp',
        {
          type: BankDetailsType.CardOrSbp,
          counterpartyOnly: false,
          withPhone: true,
        },
      ],
      [
        'mobile_commerce',
        { type: BankDetailsType.Mobile, counterpartyOnly: false },
      ],
      ['counterparty', { counterpartyOnly: true }],
    ] as const;

    for (const [method, query] of cases) {
      const { bankDetails } = await issuedTo(scenarioOf(), { method });

      expect(bankDetails.findCandidates).toHaveBeenCalledWith(query, NOW);
    }
  });

  describe('merchant admission', () => {
    it('with exclusiveTopUp on issues only to attached traders', async () => {
      const built = build(
        scenarioOf({ exclusiveTopUp: true, attached: new Set() }),
      );

      const error = await built.service
        .issue(request(), NOW)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NoRequisiteFoundError);
      expect((error as NoRequisiteFoundError).summary).toEqual({
        considered: 2,
        dropped: { [SelectionFilter.MerchantNotAdmitted]: 2 },
        attempted: 0,
        skippedUnderLock: {},
        issuedBankDetailsId: null,
      });
      expect(built.transactions.createIssuedDeal).toHaveBeenCalledWith(
        expect.anything(),
        [],
        expect.anything(),
      );
    });

    it('with exclusiveTopUp off puts attached traders first, then everyone else', async () => {
      const { result, transactions } = await issuedTo(
        scenarioOf({ attached: new Set([HEALTHY]) }),
      );

      expect(result.transaction.bankDetailsId).toBe(REQ_HEALTHY);
      expect(
        transactions.createIssuedDeal.mock.calls[0][1].map(
          (candidate) => candidate.bankDetailsId,
        ),
      ).toEqual([REQ_HEALTHY, REQ_VICTIM]);
    });

    it('drops an attached trader whose attachment has trading or the method switched off', async () => {
      const { result } = await issuedTo(
        scenarioOf({ switchedOff: new Set([VICTIM]) }),
      );

      expect(result.summary.dropped).toEqual({
        [SelectionFilter.MerchantNotAdmitted]: 1,
      });
    });
  });

  describe('the ranking', () => {
    it('without attachments gives the deal to the requisite idle the longest, a never-used one first', async () => {
      const { transactions } = await issuedTo({
        ...scenarioOf({
          requisites: [
            requisite(REQ_VICTIM, VICTIM),
            requisite(REQ_HEALTHY, HEALTHY),
            requisite(REQ_THIRD, THIRD),
          ],
        }),
        usage: new Map([
          [
            REQ_VICTIM,
            freshUsage({ lastDealAt: new Date('2026-11-04T11:00:00Z') }),
          ],
          [
            REQ_HEALTHY,
            freshUsage({ lastDealAt: new Date('2026-11-04T09:00:00Z') }),
          ],
        ]),
      });

      expect(
        transactions.createIssuedDeal.mock.calls[0][1].map(
          (candidate) => candidate.bankDetailsId,
        ),
      ).toEqual([REQ_THIRD, REQ_HEALTHY, REQ_VICTIM]);
    });

    it('hands at most five candidates to the issue', async () => {
      const many = Array.from({ length: 8 }, (_, index) =>
        requisite(uuidOf(200 + index), HEALTHY),
      );
      const { transactions } = await issuedTo(scenarioOf({ requisites: many }));

      expect(transactions.createIssuedDeal.mock.calls[0][1]).toHaveLength(5);
    });
  });

  describe('under lock', () => {
    it('tries the next candidate when the first breaks a limit under the lock, and journals both', async () => {
      const { result, attempts } = await issuedTo({
        ...scenarioOf({ attached: new Set([VICTIM]) }),
        locked: new Map([
          [
            REQ_VICTIM,
            requisite(REQ_VICTIM, VICTIM, { maxActiveTransactions: 1 }),
          ],
        ]),
        lockedUsage: new Map([[REQ_VICTIM, freshUsage({ openDeals: 1 })]]),
      });

      expect(result.transaction.bankDetailsId).toBe(REQ_HEALTHY);
      expect(result.summary).toMatchObject({
        attempted: 2,
        skippedUnderLock: { [SelectionFilter.MaxActive]: 1 },
      });
      expect(attempts.save).toHaveBeenCalledWith([
        {
          requestId: uuidOf(777),
          transactionId: null,
          traderUserId: VICTIM,
          bankDetailsId: REQ_VICTIM,
          outcome: SelectionOutcome.Skipped,
          reason: SelectionFilter.MaxActive,
        },
        {
          requestId: uuidOf(777),
          transactionId: `deal-${REQ_HEALTHY}`,
          traderUserId: HEALTHY,
          bankDetailsId: REQ_HEALTHY,
          outcome: SelectionOutcome.Issued,
          reason: null,
        },
      ]);
    });

    it('skips a requisite deleted before the lock was taken', async () => {
      const { result } = await issuedTo({
        ...scenarioOf({ attached: new Set([VICTIM]) }),
        locked: new Map([[REQ_VICTIM, null]]),
      });

      expect(result.summary.skippedUnderLock).toEqual({
        [SelectionFilter.RequisiteUnavailable]: 1,
      });
    });

    it('re-checks the requisite itself under the lock', async () => {
      const { result } = await issuedTo({
        ...scenarioOf({ attached: new Set([VICTIM]) }),
        locked: new Map([
          [REQ_VICTIM, requisite(REQ_VICTIM, VICTIM, { active: false })],
        ]),
      });

      expect(result.summary.skippedUnderLock).toEqual({
        [SelectionFilter.RequisiteDisabled]: 1,
      });
    });

    it('fails with the summary when every candidate fails under lock, journaling each', async () => {
      const built = build(
        scenarioOf({ escrowConflict: new Set([VICTIM, HEALTHY]) }),
      );

      const error = (await built.service
        .issue(request(), NOW)
        .catch((caught: unknown) => caught)) as NoRequisiteFoundError;

      expect(error).toBeInstanceOf(NoRequisiteFoundError);
      expect(error.summary).toMatchObject({
        attempted: 2,
        skippedUnderLock: { [SelectionFilter.InsufficientBalance]: 2 },
        issuedBankDetailsId: null,
      });
      expect(built.attempts.save.mock.calls[0][0]).toHaveLength(2);
    });

    it('does not fail the deal when the journal cannot be written', async () => {
      const built = build(scenarioOf());
      built.attempts.save.mockRejectedValueOnce(new Error('db down'));
      jest
        .spyOn(
          (built.service as unknown as { logger: { error: () => void } })
            .logger,
          'error',
        )
        .mockImplementation();

      await expect(built.service.issue(request(), NOW)).resolves.toMatchObject({
        transaction: { bankDetailsId: REQ_VICTIM },
      });
    });
  });

  describe('a counterparty (AC-4.2)', () => {
    const KA_BOUND = uuidOf(301);
    const KA_RESERVE = uuidOf(302);
    const KA_OTHER = uuidOf(303);
    const ka = (
      id: string,
      userId: string,
      overrides: Partial<RequisiteCandidate> = {},
    ) =>
      requisite(id, userId, {
        counterpartyOnly: true,
        maxCounterparties: 2,
        ...overrides,
      });
    const kaRequest = { method: 'counterparty' as const, counterpartyId: 40 };

    it('issues the bound requisite when it is a candidate, before anything attached', async () => {
      const { result, counterparties } = await issuedTo(
        scenarioOf({
          requisites: [ka(KA_BOUND, VICTIM), ka(KA_OTHER, HEALTHY)],
          attached: new Set([HEALTHY]),
          counterparty: { id: 40, bankDetailsId: KA_BOUND },
        }),
        kaRequest,
      );

      expect(result).toMatchObject({
        transaction: { bankDetailsId: KA_BOUND, counterpartyId: 40 },
        viaBinding: true,
        boundNow: false,
      });
      expect(counterparties.bindWithin).not.toHaveBeenCalled();
    });

    it('falls back to a reserve of the same trader and keeps the binding on the main', async () => {
      const { result, counterparties } = await issuedTo(
        scenarioOf({
          requisites: [
            ka(KA_BOUND, VICTIM, { deviceOnline: false }),
            ka(KA_RESERVE, VICTIM, { reserve: true }),
            ka(KA_OTHER, HEALTHY),
          ],
          attached: new Set([HEALTHY]),
          counterparty: { id: 40, bankDetailsId: KA_BOUND },
        }),
        kaRequest,
      );

      expect(result).toMatchObject({
        transaction: { bankDetailsId: KA_RESERVE },
        viaBinding: false,
        boundNow: false,
      });
      expect(counterparties.bindWithin).not.toHaveBeenCalled();
    });

    it('never issues a reserve of another trader', async () => {
      const built = build(
        scenarioOf({
          requisites: [
            ka(KA_BOUND, VICTIM, { active: false }),
            ka(KA_RESERVE, HEALTHY, { reserve: true }),
          ],
          counterparty: { id: 40, bankDetailsId: KA_BOUND },
        }),
      );

      const error = (await built.service
        .issue(request(kaRequest), NOW)
        .catch((caught: unknown) => caught)) as NoRequisiteFoundError;

      expect(error.summary.dropped).toEqual({
        [SelectionFilter.RequisiteDisabled]: 1,
        [SelectionFilter.ReserveOnly]: 1,
      });
    });

    it('without a reserve goes to the general counterparty requisites and keeps the old binding', async () => {
      const { result, counterparties } = await issuedTo(
        scenarioOf({
          requisites: [
            ka(KA_BOUND, VICTIM, { banned: true }),
            ka(KA_OTHER, HEALTHY),
          ],
          counterparty: { id: 40, bankDetailsId: KA_BOUND },
          boundCounts: new Map([[KA_OTHER, 2]]),
        }),
        kaRequest,
      );

      expect(result.transaction.bankDetailsId).toBe(KA_OTHER);
      expect(result.boundNow).toBe(false);
      expect(counterparties.bindWithin).not.toHaveBeenCalled();
    });

    it('binds an unbound client to the requisite it got, as the system, under the requisite lock', async () => {
      const { result, counterparties, manager } = await issuedTo(
        scenarioOf({
          requisites: [ka(KA_OTHER, HEALTHY)],
          counterparty: { id: 40, bankDetailsId: null },
        }),
        kaRequest,
      );

      expect(result.boundNow).toBe(true);
      expect(counterparties.bindWithin).toHaveBeenCalledWith(
        manager,
        40,
        expect.objectContaining({ id: KA_OTHER }),
        CounterpartyBindingType.CardsOrSbp,
        null,
      );
    });

    it('does not bind an unbound client to a requisite whose slots are full', async () => {
      const { result } = await issuedTo(
        scenarioOf({
          requisites: [ka(KA_BOUND, VICTIM), ka(KA_OTHER, HEALTHY)],
          counterparty: { id: 40, bankDetailsId: null },
          boundCounts: new Map([[KA_BOUND, 2]]),
        }),
        kaRequest,
      );

      expect(result.summary.dropped).toEqual({
        [SelectionFilter.CounterpartySlotsFull]: 1,
      });
      expect(result.transaction.bankDetailsId).toBe(KA_OTHER);
    });

    it('does not bind a client to a mobile requisite', async () => {
      const built = build(
        scenarioOf({
          requisites: [
            ka(KA_OTHER, HEALTHY, {
              type: BankDetailsType.Mobile,
              bankId: null,
              bankCurrency: null,
              mobileOperatorId: 3,
            }),
          ],
          counterparty: { id: 40, bankDetailsId: null },
        }),
      );

      const error = (await built.service
        .issue(request(kaRequest), NOW)
        .catch((caught: unknown) => caught)) as NoRequisiteFoundError;

      expect(error.summary.dropped).toEqual({
        [SelectionFilter.RequisiteNotBindable]: 1,
      });
    });

    it('moves on when the slot fills between the check and the bind', async () => {
      const built = build(
        scenarioOf({
          requisites: [ka(KA_OTHER, HEALTHY)],
          counterparty: { id: 40, bankDetailsId: null },
          bindConflict: true,
        }),
      );

      const error = (await built.service
        .issue(request(kaRequest), NOW)
        .catch((caught: unknown) => caught)) as NoRequisiteFoundError;

      expect(error.summary.skippedUnderLock).toEqual({
        [SelectionFilter.CounterpartySlotsFull]: 1,
      });
    });

    it('a non-counterparty method never reads the client binding', async () => {
      const { counterparties } = await issuedTo(scenarioOf(), {
        counterpartyId: 40,
      });

      expect(counterparties.findById).not.toHaveBeenCalled();
    });
  });

  it('refuses a method that does not work in pay-in', async () => {
    const { service } = build(scenarioOf());

    await expect(
      service.issue(request({ method: 'nope' as never }), NOW),
    ).rejects.toThrow('does not work for pay_in');
  });
});
