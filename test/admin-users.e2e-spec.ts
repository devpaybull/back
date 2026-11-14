import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { LeadRate } from '../src/transactions/entities/lead-rate.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { TransactionMethod } from '../src/transactions/types/transaction-method';
import { TraderLead } from '../src/users/entities/trader-lead.entity';
import { UserStatus } from '../src/users/types/user-status.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

interface Row {
  id: string;
  role: Role;
  balances: { mainBalance: string } | null;
  insurancePayInMin: string | null;
  insurancePayOutMin: string | null;
  tradingStatus: string | null;
  rateSummary:
    | {
        currency: string;
        payIn: { min: number; max: number };
        payOut: { min: number; max: number };
      }[]
    | null;
}

describe('the users list: row fields, search, counters and the trading sorts', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let merchantId: string;
  let otherMerchantId: string;
  const traders: E2eUser[] = [];
  const leads: E2eUser[] = [];
  const merchantSide: E2eUser[] = [];

  const get = (path: string) => e2e.http.get(path).set(bearer(admin));

  const rows = async (query: string): Promise<Row[]> =>
    (await get(`/admin/users?limit=100&${query}`).expect(200)).body
      .data as Row[];

  const methodRate = (
    method: string,
    payInPercent: number,
    payOutPercent: number,
    shape: Partial<MethodRate> = {},
  ) =>
    e2e.dataSource.getRepository(MethodRate).save({
      scope: RateScope.Trader,
      method: method as TransactionMethod,
      subjectUserId: null,
      subjectMerchantId: null,
      bankId: null,
      fromAmount: null,
      toAmount: null,
      payInPercent,
      payOutPercent,
      ...shape,
    });

  const settings = (userId: string, values: Partial<TraderSettings>) =>
    e2e.dataSource.getRepository(TraderSettings).save({ userId, ...values });

  const wallet = (userId: string, mainBalance: number) =>
    e2e.dataSource
      .getRepository(Wallet)
      .save({ userId, mainBalance: toCrypto(mainBalance) });

  const maxPayIn = (row: Row): number | null =>
    row.rateSummary?.length
      ? Math.max(...row.rateSummary.map((summary) => summary.payIn.max))
      : null;

  const expectOrderedBy = (
    listed: Row[],
    valueOf: (row: Row) => number | null,
    direction: 'asc' | 'desc',
  ) => {
    const sign = direction === 'asc' ? 1 : -1;
    const expected = [...listed].sort((one, other) => {
      const first = valueOf(one);
      const second = valueOf(other);

      if (first === null && second === null) {
        return sign * (one.id < other.id ? -1 : one.id > other.id ? 1 : 0);
      }
      if (first === null) return 1;
      if (second === null) return -1;
      if (first !== second) return sign * (first - second);

      return sign * (one.id < other.id ? -1 : 1);
    });

    expect(listed.map((row) => row.id)).toEqual(expected.map((row) => row.id));
  };

  beforeAll(async () => {
    e2e = await startE2e({ INSURANCE_PAY_IN_MIN: '700' });
    admin = await e2e.createUser(Role.Admin);
    const merchants = e2e.app.get(MerchantsService);
    merchantId = (await merchants.create('Ohla Shop')).id;
    otherMerchantId = (await merchants.create('Bingo')).id;

    const country = await e2e.http
      .post('/admin/countries')
      .set(bearer(admin))
      .send({ name: 'Россия' })
      .expect(201);
    const currencyId = (
      await e2e.http
        .post('/admin/currencies')
        .set(bearer(admin))
        .send({
          name: 'Рубль',
          isocode: 'RUB',
          countryId: country.body.data.id,
        })
        .expect(201)
    ).body.data.id as number;

    for (let index = 0; index < 5; index++) {
      traders.push(await e2e.createUser(Role.Trader));
    }
    for (let index = 0; index < 2; index++) {
      leads.push(await e2e.createUser(Role.LeadTrader));
    }
    merchantSide.push(
      await e2e.createUser(Role.Merchant, { merchantId }),
      await e2e.createUser(Role.MerchantSupport, { merchantId }),
      await e2e.createUser(Role.MerchantAgent, {
        merchantId: otherMerchantId,
      }),
    );
    await e2e.createUser(Role.Cascade);

    await methodRate('sbp', 10, 2);
    await methodRate('card', 12, 3);
    await methodRate('mobile_commerce', 6, 0);
    await methodRate('retired_method', 99, 9);

    const [off, bands, own, bare, enabled] = traders.map((t) => t.user.id);

    await settings(off, {
      individualRatesEnabled: false,
      tradingEnabled: true,
      insurancePayInMin: toCrypto(1000),
      insurancePayOutMin: toCrypto(450),
    });
    await methodRate('sbp', 40, 9, { subjectUserId: off });
    await wallet(off, 500);

    await settings(bands, { individualRatesEnabled: true });
    await methodRate('card', 4, 1, { subjectUserId: bands });
    await methodRate('sbp', 15, 2.5, {
      subjectUserId: bands,
      fromAmount: toFiat('1000'),
      toAmount: toFiat('5000'),
    });
    await wallet(bands, 2000);

    await settings(own, {
      individualRatesEnabled: true,
      insurancePayInMin: toCrypto(200),
    });
    await methodRate('sbp', 5, 1, { subjectUserId: own });
    await methodRate('card', 7, 1, { subjectUserId: own });
    await methodRate('mobile_commerce', 3, 0, { subjectUserId: own });
    await methodRate('retired_method', 50, 0, { subjectUserId: own });

    await wallet(bare, 2000);

    await settings(enabled, { tradingEnabled: true });

    const link = await e2e.dataSource.getRepository(TraderLead).save({
      traderUserId: off,
      leadUserId: leads[0].user.id,
      currencyId,
      payInPercent: 1.5,
      payOutPercent: 0.5,
    });
    await e2e.dataSource.getRepository(TraderLead).save({
      traderUserId: bands,
      leadUserId: leads[0].user.id,
      currencyId,
      payInPercent: 0.75,
      payOutPercent: 0.25,
    });
    await e2e.dataSource.getRepository(LeadRate).save({
      traderLeadId: link.id,
      method: 'sbp',
      bankId: null,
      fromAmount: null,
      toAmount: null,
      payInPercent: 2.5,
      payOutPercent: 0.1,
    });
    await wallet(leads[0].user.id, 100);

    const suspended = await e2e.createUser(Role.Trader, {
      status: UserStatus.Suspended,
    });
    traders.push(suspended);
    await settings(suspended.user.id, { tradingEnabled: true });
  });

  afterAll(async () => {
    await e2e?.close();
  });

  describe('the row of a trader and a lead', () => {
    let byId: Map<string, Row>;

    beforeAll(async () => {
      byId = new Map(
        (await rows('role=trader&role=lead_trader')).map((row) => [
          row.id,
          row,
        ]),
      );
    });

    const rowOf = (user: E2eUser): Row => byId.get(user.user.id) as Row;

    it('summarises the rates that apply: base with individual rates off, whatever is stored', () => {
      expect(rowOf(traders[0]).rateSummary).toEqual([
        {
          currency: 'RUB',
          payIn: { min: 6, max: 12 },
          payOut: { min: 0, max: 3 },
        },
      ]);
    });

    it('takes every individual row and the base for a method without an individual general rate', () => {
      expect(rowOf(traders[1]).rateSummary).toEqual([
        {
          currency: 'RUB',
          payIn: { min: 4, max: 15 },
          payOut: { min: 0, max: 2.5 },
        },
      ]);
      expect(rowOf(traders[2]).rateSummary).toEqual([
        {
          currency: 'RUB',
          payIn: { min: 3, max: 7 },
          payOut: { min: 0, max: 1 },
        },
      ]);
    });

    it('spans a lead’s shares over every trader it leads, and gives a lead with none an empty summary', () => {
      expect(rowOf(leads[0]).rateSummary).toEqual([
        {
          currency: 'RUB',
          payIn: { min: 0.75, max: 2.5 },
          payOut: { min: 0.1, max: 0.5 },
        },
      ]);
      expect(rowOf(leads[1]).rateSummary).toEqual([]);
    });

    it('carries both effective minimums', () => {
      expect(rowOf(traders[0]).insurancePayInMin).toBe('1000.000000');
      expect(rowOf(traders[0]).insurancePayOutMin).toBe('450.000000');
      expect(rowOf(traders[1]).insurancePayInMin).toBe('700.000000');
      expect(rowOf(traders[1]).insurancePayOutMin).toBe('300.000000');
    });

    it('tells the trading switch, with a suspended account blocked over it', () => {
      expect(rowOf(traders[0]).tradingStatus).toBe('enabled');
      expect(rowOf(traders[1]).tradingStatus).toBe('disabled');
      expect(rowOf(traders[3]).tradingStatus).toBe('disabled');
      expect(rowOf(traders[5]).tradingStatus).toBe('blocked');
    });

    it('gives every other role null', async () => {
      for (const row of await rows('role=merchant&role=admin&role=cascade')) {
        expect(row.insurancePayOutMin).toBeNull();
        expect(row.tradingStatus).toBeNull();
        expect(row.rateSummary).toBeNull();
      }
    });
  });

  describe('the trading sorts agree with the values the row carries', () => {
    const scope = 'role=trader&role=lead_trader';

    it.each(['asc', 'desc'] as const)(
      'orders by the highest applicable pay-in percent, %s, without a value last',
      async (direction) => {
        const listed = await rows(
          `${scope}&sortBy=rate&sortOrder=${direction}`,
        );

        expectOrderedBy(listed, maxPayIn, direction);
        expect(maxPayIn(listed[listed.length - 1])).toBeNull();
      },
    );

    it.each(['asc', 'desc'] as const)(
      'orders by the effective pay-in minimum, %s',
      async (direction) => {
        expectOrderedBy(
          await rows(`${scope}&sortBy=insuranceMin&sortOrder=${direction}`),
          (row) => Number(row.insurancePayInMin),
          direction,
        );
      },
    );

    it.each(['asc', 'desc'] as const)(
      'orders by the main balance, %s, an account without a wallet last',
      async (direction) => {
        const listed = await rows(
          `${scope}&sortBy=balance&sortOrder=${direction}`,
        );

        expectOrderedBy(
          listed,
          (row) => (row.balances ? Number(row.balances.mainBalance) : null),
          direction,
        );
        expect(listed[listed.length - 1].balances).toBeNull();
      },
    );

    it('pages the ordered rows and counts all of them', async () => {
      const whole = await rows(`${scope}&sortBy=rate`);
      const page = await get(
        `/admin/users?${scope}&sortBy=rate&page=2&limit=3`,
      ).expect(200);

      expect(page.body.meta.total).toBe(whole.length);
      expect(page.body.data.map((row: Row) => row.id)).toEqual(
        whole.slice(3, 6).map((row) => row.id),
      );
    });

    it.each(['', '&role=admin', '&role=trader&role=merchant'])(
      'refuses a trading sort for roles without the value (%s)',
      async (roles) => {
        for (const sortBy of ['balance', 'insuranceMin', 'rate']) {
          await get(`/admin/users?sortBy=${sortBy}${roles}`).expect(400);
        }
      },
    );
  });

  describe('search and counters', () => {
    it('finds a merchant-side account by its merchant’s name, and no other role', async () => {
      const found = await rows('search=OHLA');

      expect(found.map((row) => row.id).sort()).toEqual(
        [merchantSide[0].user.id, merchantSide[1].user.id].sort(),
      );
    });

    it('answers every role, zero included', async () => {
      const counters = (await get('/admin/users/counters').expect(200)).body
        .data;

      expect(counters.byRole).toEqual({
        trader: 6,
        lead_trader: 2,
        merchant: 1,
        merchant_support: 1,
        merchant_agent: 1,
        cascade: 1,
        admin: 1,
        superadmin: 0,
      });
      expect(counters.all).toBe(13);
    });

    it.each([
      '',
      'search=ohla',
      'search=trader',
      'status=suspended',
      'merchantId=MERCHANT',
      'search=bingo&status=active',
    ])(
      'agrees with the list total under the same filters (%s)',
      async (raw) => {
        const query = raw.replace('MERCHANT', merchantId);
        const counters = (
          await get(`/admin/users/counters?${query}`).expect(200)
        ).body.data;

        expect(
          (await get(`/admin/users?${query}`).expect(200)).body.meta.total,
        ).toBe(counters.all);

        for (const [role, count] of Object.entries(counters.byRole)) {
          expect(
            (await get(`/admin/users?${query}&role=${role}`).expect(200)).body
              .meta.total,
          ).toBe(count);
        }
      },
    );

    it('refuses a role filter on the counters', async () => {
      await get('/admin/users/counters?role=trader').expect(400);
    });

    it('is closed to a trader', async () => {
      await e2e.http
        .get('/admin/users/counters')
        .set(bearer(traders[0]))
        .expect(403);
    });
  });
});
