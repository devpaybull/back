import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { Counterparty } from '../src/counterparties/entities/counterparty.entity';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { SelectionAttempt } from '../src/transactions/entities/selection-attempt.entity';
import { TransactionDispute } from '../src/transactions/entities/transaction-dispute.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { DisputeStatus } from '../src/transactions/types/dispute-status.enum';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { SelectionFilter } from '../src/transactions/types/selection-filter.enum';
import { SelectionOutcome } from '../src/transactions/types/selection-outcome.enum';
import { StatusEventSource } from '../src/transactions/types/status-event-source.enum';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../src/transactions/types/transaction-status.enum';
import { User } from '../src/users/entities/user.entity';
import { UserStatus } from '../src/users/types/user-status.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('the trader cabinet: counterparties, statistics, activity, notification settings', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let stranger: E2eUser;
  let key: string;
  let bankId: number;
  let first: string;
  let second: string;
  let plain: string;
  let foreign: string;

  const ready = async (owner: E2eUser): Promise<number> => {
    const deviceId = await deviceOf(e2e, owner);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date(Date.now() + 3_600_000) });
    await e2e.dataSource
      .getRepository(TraderSettings)
      .save({ userId: owner.user.id, tradingEnabled: true });
    await e2e.dataSource.getRepository(Wallet).save({
      userId: owner.user.id,
      mainBalance: toCrypto(100000),
      insurancePayInBalance: toCrypto(1000),
    });

    return deviceId;
  };

  const requisite = async (
    owner: E2eUser,
    deviceId: number,
    phone: string,
    slots: number | null,
  ): Promise<string> =>
    (
      await e2e.http
        .post('/trader/requisites')
        .set(bearer(owner))
        .send({
          type: 'card_or_sbp',
          bankId,
          deviceId,
          phone,
          cardholderName: 'IVAN IVANOV',
          dailyAmountLimit: '1000000.00',
          ...(slots === null
            ? {}
            : { counterpartyOnly: true, maxCounterparties: slots }),
        })
        .expect(201)
    ).body.data.id as string;

  const payIn = async (client: string, amount: string): Promise<string> =>
    (
      await e2e.http
        .post('/v1/payment/pay-in')
        .set('X-Secure-Key', key)
        .send({
          method: 'counterparty',
          amount,
          merchantTransactionId: `order-${Math.random().toString(36).slice(2)}`,
          payerInfo: { userId: client, ip: '203.0.113.7' },
        })
        .expect(201)
    ).body.data.id as string;

  const deal = (id: string) =>
    e2e.dataSource.getRepository(Transaction).findOneOrFail({ where: { id } });
  const client = (externalId: string) =>
    e2e.dataSource
      .getRepository(Counterparty)
      .findOneOrFail({ where: { externalId } });

  beforeAll(async () => {
    e2e = await startE2e();
    const superadmin = await e2e.createUser(Role.Superadmin);
    admin = await e2e.createUser(Role.Admin);
    const merchantId = (await e2e.app.get(MerchantsService).create('Casino'))
      .id;
    key = (
      await e2e.http
        .post(`/admin/merchants/${merchantId}/keys`)
        .set(bearer(superadmin))
        .expect(201)
    ).body.data.key as string;

    const country = await e2e.http
      .post('/admin/countries')
      .set(bearer(admin))
      .send({ name: 'Россия' })
      .expect(201);
    const currency = await e2e.http
      .post('/admin/currencies')
      .set(bearer(admin))
      .send({ name: 'Рубль', isocode: 'RUB', countryId: country.body.data.id })
      .expect(201);
    bankId = (
      await e2e.http
        .post('/admin/banks')
        .set(bearer(admin))
        .send({
          bankId: 'tbank',
          code: 'tbank',
          name: 'Т-банк',
          countryId: country.body.data.id,
          currencyId: currency.body.data.id,
          transactionTypes: ['card', 'sbp'],
        })
        .expect(201)
    ).body.data.id as number;

    await e2e.dataSource.getRepository(MethodRate).save([
      {
        scope: RateScope.Trader,
        method: 'counterparty',
        payInPercent: 7,
        payOutPercent: 0,
      },
      {
        scope: RateScope.Merchant,
        method: 'counterparty',
        payInPercent: 10,
        payOutPercent: 0,
      },
    ]);
    await e2e.dataSource.getRepository(MerchantMethod).save({
      merchantId,
      method: 'counterparty',
      payInEnabled: true,
      payOutEnabled: false,
    });

    trader = await e2e.createUser(Role.Trader);
    stranger = await e2e.createUser(Role.Trader);
    const device = await ready(trader);
    first = await requisite(trader, device, '+79010000001', 1);
    second = await requisite(trader, device, '+79010000002', 1);
    plain = await requisite(trader, device, '+79010000003', null);
    foreign = await requisite(
      stranger,
      await deviceOf(e2e, stranger),
      '+79010000004',
      5,
    );
    await e2e.dataSource
      .getRepository(TraderSettings)
      .update({ userId: stranger.user.id }, { tradingEnabled: false });
  });

  afterAll(() => e2e?.close());

  describe('counterparties (TC08)', () => {
    let boundTo: string;
    let other: string;
    let clientId: number;

    it('shows a client bound by its first deposit, with the trader’s own figures and never the merchant’s client id', async () => {
      const id = await payIn('client-1', '6000');
      boundTo = (await deal(id)).bankDetailsId;
      other = boundTo === first ? second : first;
      clientId = (await client('client-1')).id;
      await e2e.http
        .post(`/trader/deals/${id}/confirm`)
        .set(bearer(trader))
        .expect(200);

      const list = await e2e.http
        .get('/trader/counterparties')
        .set(bearer(trader))
        .expect(200);
      expect(list.body.data).toEqual([
        {
          id: clientId,
          bankDetailsId: boundTo,
          status: 'active',
          conversion: 100,
          paidCount: 1,
          completedCount: 1,
          averageCheck: '6000.00',
          volume: '6000.00',
          lastDealAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(list.body)).not.toContain('client-1');
      expect(JSON.stringify(list.body)).not.toContain('Casino');

      const summary = await e2e.http
        .get('/trader/counterparties/summary')
        .set(bearer(trader))
        .expect(200);
      expect(summary.body.data).toEqual({
        total: 1,
        averageConversion: 100,
        deposits30d: '6000.00',
        averageCheck: '6000.00',
      });

      const groups = await e2e.http
        .get('/trader/counterparties/groups')
        .set(bearer(trader))
        .query({ bankDetailsId: boundTo })
        .expect(200);
      expect(groups.body.data).toEqual([
        expect.objectContaining({
          requisite: expect.objectContaining({ id: boundTo, status: 'active' }),
          slots: { bound: 1, max: 1 },
          deposits30d: '6000.00',
        }),
      ]);
      expect(groups.body.meta.total).toBe(1);

      const foreignView = await e2e.http
        .get('/trader/counterparties')
        .set(bearer(stranger))
        .expect(200);
      expect(foreignView.body.data).toEqual([]);
      await e2e.http
        .delete(`/trader/counterparties/${clientId}`)
        .set(bearer(stranger))
        .expect(404);
      await e2e.http
        .post(`/trader/counterparties/${clientId}/move`)
        .set(bearer(stranger))
        .send({ bankDetailsId: foreign })
        .expect(404);
      await e2e.http
        .get('/trader/counterparties')
        .set(bearer(admin))
        .expect(403);
    });

    it('moves the client only to another free counterparty-only requisite of the same trader', async () => {
      const move = (bankDetailsId: string) =>
        e2e.http
          .post(`/trader/counterparties/${clientId}/move`)
          .set(bearer(trader))
          .send({ bankDetailsId });

      await move(foreign).expect(404);
      await move(plain).expect(409);
      await move(boundTo).expect(409);

      const moved = await move(other).expect(200);
      expect(moved.body.data).toEqual({ id: clientId, bankDetailsId: other });

      const groups = await e2e.http
        .get('/trader/counterparties/groups')
        .set(bearer(trader))
        .expect(200);
      const slotsOf = (id: string) =>
        (
          groups.body.data as {
            requisite: { id: string };
            slots: { bound: number };
          }[]
        ).find((row) => row.requisite.id === id)?.slots.bound;
      expect(slotsOf(other)).toBe(1);
      expect(slotsOf(boundTo)).toBe(0);

      const second = await payIn('client-2', '7000');
      expect((await deal(second)).bankDetailsId).toBe(boundTo);
      await e2e.http
        .post(`/trader/deals/${second}/decline`)
        .set(bearer(trader))
        .send({ reasonCode: 'limit_reached' })
        .expect(200);
      await e2e.http
        .post(`/trader/counterparties/${(await client('client-2')).id}/move`)
        .set(bearer(trader))
        .send({ bankDetailsId: other })
        .expect(409);

      const next = await payIn('client-1', '6100');
      expect((await deal(next)).bankDetailsId).toBe(other);
      await e2e.http
        .post(`/trader/deals/${next}/decline`)
        .set(bearer(trader))
        .send({ reasonCode: 'limit_reached' })
        .expect(200);

      const replaced = await e2e.dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: 'counterparty.requisite_replaced' });
      expect(replaced.actorUserId).toBe(trader.user.id);
    });

    it('hides the inactive, and lets a client go without touching its deals', async () => {
      const shown = async (query: Record<string, string>) =>
        (
          (
            await e2e.http
              .get('/trader/counterparties')
              .set(bearer(trader))
              .query(query)
              .expect(200)
          ).body.data as { id: number; status: string }[]
        ).map((row) => [row.id, row.status]);
      const quiet = (await client('client-2')).id;

      expect(await shown({ sortBy: 'id', sortOrder: 'asc' })).toEqual([
        [clientId, 'active'],
        [quiet, 'inactive'],
      ]);
      expect(await shown({ hideInactive: 'true' })).toEqual([
        [clientId, 'active'],
      ]);

      await e2e.http
        .delete(`/trader/counterparties/${clientId}`)
        .set(bearer(trader))
        .expect(200);
      expect((await client('client-1')).bankDetailsId).toBeNull();
      expect(await shown({})).toEqual([[quiet, 'inactive']]);
      await e2e.http
        .delete(`/trader/counterparties/${clientId}`)
        .set(bearer(trader))
        .expect(404);
      expect(
        await e2e.dataSource.getRepository(Transaction).count({
          where: { counterpartyId: clientId },
        }),
      ).toBe(2);
    });
  });

  describe('statistics (TC06)', () => {
    let statsTrader: E2eUser;
    let statsRequisite: string;

    beforeAll(async () => {
      statsTrader = await e2e.createUser(Role.Trader);
      statsRequisite = await requisite(
        statsTrader,
        await ready(statsTrader),
        '+79010000009',
        null,
      );
      const now = Date.now();
      const deals = e2e.dataSource.getRepository(Transaction);
      const payInOf = (
        amount: string,
        status = TransactionStatus.Success,
      ): Partial<Transaction> => ({
        kind: TransactionKind.PayIn,
        status,
        method: 'sbp',
        traderUserId: statsTrader.user.id,
        bankDetailsId: statsRequisite,
        amountFiat: toFiat(amount),
        amountCrypto: toCrypto(toFiat(amount).div(100)),
        traderCommission: toCrypto('0.1'),
        createdAt: new Date(now - 600_000),
        resolvedAt: new Date(now - 300_000),
      });
      const saved = await deals.save([
        ...[
          '999.99',
          '1000.00',
          '2000.00',
          '2000.01',
          '5000.00',
          '10000.00',
          '10000.01',
        ].map((amount) => payInOf(amount)),
        payInOf('3000.00', TransactionStatus.SuccessChanged),
        payInOf('500.00', TransactionStatus.Canceled),
      ]);
      await deals.save({
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Success,
        method: 'sbp',
        traderUserId: statsTrader.user.id,
        amountFiat: toFiat('1500'),
        amountCrypto: toCrypto('15'),
        traderCommission: toCrypto('0.2'),
        payoutTakenAt: new Date(now - 400_000),
        payoutCompletedAt: new Date(now - 280_000),
        resolvedAt: new Date(now - 100_000),
      });
      await e2e.dataSource.getRepository(TransactionDispute).save({
        transactionId: saved[0].id,
        status: DisputeStatus.Accepted,
        statusBefore: TransactionStatus.Success,
        openedAt: new Date(now - 3_000_000),
        resolvedAt: new Date(now - 2_400_000),
      });
      await e2e.dataSource.getRepository(TransactionStatusEvent).save({
        transactionId: saved[0].id,
        fromStatus: TransactionStatus.Success,
        toStatus: TransactionStatus.Dispute,
        source: StatusEventSource.Merchant,
      });
      await e2e.dataSource.getRepository(SelectionAttempt).save([
        ...[1, 2, 3].map(() => ({
          traderUserId: statsTrader.user.id,
          bankDetailsId: statsRequisite,
          method: 'sbp' as const,
          outcome: SelectionOutcome.Issued,
          reason: null,
        })),
        {
          traderUserId: statsTrader.user.id,
          bankDetailsId: statsRequisite,
          method: 'sbp' as const,
          outcome: SelectionOutcome.Skipped,
          reason: SelectionFilter.MaxActive,
        },
      ]);
    });

    it('answers the cards from the trader’s own deals of today', async () => {
      const summary = await e2e.http
        .get('/trader/stats/summary')
        .set(bearer(statsTrader))
        .query({ direction: 'pay_in' })
        .expect(200);

      expect(summary.body.data).toEqual({
        issue: { issued: 3, skipped: 1, percent: 75 },
        payment: { paid: 8, canceled: 1, percent: 88.89 },
        turnover: { amount: '34000.01', count: 8, averageCheck: '4250.00' },
        income: { amount: '0.800000', averageRate: '100.000000' },
        response: {
          depositSeconds: 300,
          payoutSeconds: null,
          disputeSeconds: 600,
        },
      });

      const payouts = await e2e.http
        .get('/trader/stats/summary')
        .set(bearer(statsTrader))
        .query({ direction: 'pay_out', period: 'all_time' })
        .expect(200);
      expect(payouts.body.data.response.payoutSeconds).toBe(120);
      expect(payouts.body.data.issue).toEqual({
        issued: 0,
        skipped: 0,
        percent: null,
      });

      const strangers = await e2e.http
        .get('/trader/stats/summary')
        .set(bearer(stranger))
        .query({ period: 'all_time' })
        .expect(200);
      expect(strangers.body.data.turnover.count).toBe(0);
    });

    it('cuts the buckets on their boundaries', async () => {
      const buckets = await e2e.http
        .get('/trader/stats/buckets')
        .set(bearer(statsTrader))
        .query({ direction: 'pay_in', bankDetailsId: statsRequisite })
        .expect(200);

      expect(
        (buckets.body.data as { range: string; count: number }[]).map(
          (bucket) => [bucket.range, bucket.count],
        ),
      ).toEqual([
        ['1-999', 1],
        ['1000-2000', 2],
        ['2001-5000', 3],
        ['5001-10000', 1],
        ['10000+', 1],
      ]);
      expect(buckets.body.data[2]).toEqual({
        range: '2001-5000',
        count: 3,
        volumeCrypto: '100.000100',
        volumeFiat: '10000.01',
      });
    });

    it('answers fourteen days ending today', async () => {
      const daily = await e2e.http
        .get('/trader/stats/daily')
        .set(bearer(statsTrader))
        .query({ direction: 'pay_in' })
        .expect(200);

      expect(daily.body.data).toHaveLength(14);
      expect(daily.body.data[13]).toEqual({
        date: expect.any(String),
        income: '0.800000',
        turnover: '34000.01',
        conversionPercent: 88.89,
        disputePercent: 11.11,
      });
      expect(daily.body.data[0]).toEqual(
        expect.objectContaining({
          income: '0.000000',
          conversionPercent: null,
        }),
      );
      await e2e.http
        .get('/trader/stats/summary')
        .set(bearer(statsTrader))
        .query({
          period: 'today',
          periodFrom: '2026-11-01',
          periodTo: '2026-11-02',
        })
        .expect(400);
    });
  });

  describe('activity and notification settings (TC12)', () => {
    it('lists the trader’s own sign-ins and switches, not an admin’s, with no IP', async () => {
      await e2e.http
        .post('/trader/trading')
        .set(bearer(trader))
        .send({ enabled: false })
        .expect(200);
      await e2e.http
        .patch(`/admin/users/${trader.user.id}/settings`)
        .set(bearer(admin))
        .send({ tradingEnabled: true })
        .expect(200);

      const feed = await e2e.http
        .get('/trader/activity')
        .set(bearer(trader))
        .query({ limit: 100 })
        .expect(200);
      const actions = (feed.body.data as { action: string }[]).map(
        (row) => row.action,
      );

      expect(actions).toEqual(
        expect.arrayContaining([
          'trader_activity.login',
          'activity.trading_disabled',
          'activity.bank_details_added',
          'trader.deal_confirmed',
          'trader.deal_declined',
        ]),
      );
      expect(actions).not.toContain('activity.trading_enabled');
      expect(JSON.stringify(feed.body)).not.toContain('203.0.113');
      expect(JSON.stringify(feed.body)).not.toContain('"ip"');

      const foreign = await e2e.http
        .get('/trader/activity')
        .set(bearer(stranger))
        .query({ limit: 100 })
        .expect(200);
      expect(
        (foreign.body.data as { details: Record<string, unknown> }[]).some(
          (row) => row.details.id === first,
        ),
      ).toBe(false);
    });

    it('stores the notification switches, trading_blocked always on', async () => {
      const initial = await e2e.http
        .get('/trader/notification-settings')
        .set(bearer(trader))
        .expect(200);
      expect(initial.body.data).toHaveLength(12);
      expect(
        (initial.body.data as { type: string; enabled: boolean }[])
          .filter((row) => row.enabled)
          .map((row) => row.type),
      ).toEqual(['trading_blocked']);

      const put = (settings: unknown[], as: E2eUser = trader) =>
        e2e.http
          .put('/trader/notification-settings')
          .set(bearer(as))
          .send({ settings });

      await put([
        { type: 'balance_below_threshold', enabled: true, threshold: 100 },
      ]).expect(400);
      await put([{ type: 'balance_below_threshold', enabled: true }]).expect(
        400,
      );
      await put([
        { type: 'new_payouts', enabled: true },
        { type: 'new_payouts', enabled: false },
      ]).expect(400);

      const saved = await put([
        {
          type: 'balance_below_threshold',
          enabled: true,
          threshold: '150.5',
        },
        {
          type: 'requisite_limit_reached',
          enabled: true,
          method: 'sbp',
          limitType: 'hourly',
        },
        { type: 'trading_blocked', enabled: false },
      ]).expect(200);
      const byType = new Map(
        (saved.body.data as { type: string }[]).map((row) => [row.type, row]),
      );
      expect(byType.get('balance_below_threshold')).toEqual({
        type: 'balance_below_threshold',
        enabled: true,
        alwaysOn: false,
        threshold: '150.500000',
        method: null,
        limitType: null,
      });
      expect(byType.get('requisite_limit_reached')).toMatchObject({
        enabled: true,
        method: 'sbp',
        limitType: 'hourly',
      });
      expect(byType.get('trading_blocked')).toMatchObject({ enabled: true });

      const again = await e2e.http
        .get('/trader/notification-settings')
        .set(bearer(trader))
        .expect(200);
      expect(again.body.data).toEqual(saved.body.data);

      const others = await e2e.http
        .get('/trader/notification-settings')
        .set(bearer(stranger))
        .expect(200);
      expect(
        (others.body.data as { type: string; enabled: boolean }[]).find(
          (row) => row.type === 'balance_below_threshold',
        ),
      ).toMatchObject({ enabled: false, threshold: null });

      await e2e.http
        .get('/trader/notification-settings')
        .set(bearer(admin))
        .expect(403);
      await e2e.dataSource
        .getRepository(User)
        .update(stranger.user.id, { status: UserStatus.Suspended });
      await put([{ type: 'new_payouts', enabled: true }], stranger).expect(403);
    });
  });
});
