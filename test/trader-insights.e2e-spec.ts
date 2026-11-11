import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { AuditService } from '../src/audit/services/audit.service';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { CounterpartyTraderDailyVolume } from '../src/counterparties/entities/counterparty-trader-daily-volume.entity';
import { CounterpartyTraderStats } from '../src/counterparties/entities/counterparty-trader-stats.entity';
import { CounterpartyDailyVolume } from '../src/counterparties/entities/counterparty-daily-volume.entity';
import { Counterparty } from '../src/counterparties/entities/counterparty.entity';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { NotificationSetting } from '../src/trader-settings/entities/notification-setting.entity';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { NotificationType } from '../src/trader-settings/types/notification-type.enum';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { SelectionAttempt } from '../src/transactions/entities/selection-attempt.entity';
import { TransactionDispute } from '../src/transactions/entities/transaction-dispute.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { CounterpartyDealStatsService } from '../src/transactions/services/counterparty-deal-stats.service';
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

    it('sorts, filters and pages the bound clients in the database from the counters of each pair, which the rebuild reproduces', async () => {
      const settings = e2e.dataSource.getRepository(TraderSettings);
      await settings.update(
        { userId: trader.user.id },
        { tradingEnabled: false },
      );
      const pageTrader = await e2e.createUser(Role.Trader);
      const device = await ready(pageTrader);
      const slotted = await requisite(pageTrader, device, '+79010000011', 5);
      const settle = async (
        externalId: string,
        amount: string,
        action: 'confirm' | 'decline',
      ) => {
        const id = await payIn(externalId, amount);
        expect((await deal(id)).bankDetailsId).toBe(slotted);
        await e2e.http
          .post(`/trader/deals/${id}/${action}`)
          .set(bearer(pageTrader))
          .send(action === 'decline' ? { reasonCode: 'limit_reached' } : {})
          .expect(200);

        return id;
      };

      const settledA = await settle('page-a', '6000', 'confirm');
      await settle('page-b', '7000', 'confirm');
      await settle('page-b', '8000', 'decline');
      const canceledC = await settle('page-c', '9000', 'decline');
      const empty = await requisite(pageTrader, device, '+79010000012', 1);
      const [a, b, c] = await Promise.all(
        ['page-a', 'page-b', 'page-c'].map(
          async (externalId) => (await client(externalId)).id,
        ),
      );
      const list = (query: Record<string, string>) =>
        e2e.http
          .get('/trader/counterparties')
          .set(bearer(pageTrader))
          .query(query)
          .expect(200);
      const idsOf = (body: { data: { id: number }[] }) =>
        body.data.map((row) => row.id);

      const first = await list({ sortBy: 'volume', limit: '2' });
      expect(idsOf(first.body)).toEqual([b, a]);
      expect(first.body.meta).toEqual({
        total: 3,
        page: 1,
        limit: 2,
        pages: 2,
      });
      expect(
        idsOf((await list({ sortBy: 'volume', limit: '2', page: '2' })).body),
      ).toEqual([c]);
      expect(
        (await list({ sortBy: 'conversion', sortOrder: 'asc' })).body.data,
      ).toEqual([
        expect.objectContaining({
          id: c,
          conversion: 0,
          completedCount: 1,
          status: 'inactive',
        }),
        expect.objectContaining({
          id: b,
          conversion: 50,
          paidCount: 1,
          completedCount: 2,
          averageCheck: '7000.00',
          volume: '7000.00',
        }),
        expect.objectContaining({ id: a, conversion: 100 }),
      ]);
      const active = await list({ hideInactive: 'true', sortBy: 'id' });
      expect(idsOf(active.body)).toEqual([b, a].sort((x, y) => y - x));
      expect(active.body.meta.total).toBe(2);
      expect(idsOf((await list({ bankDetailsId: empty })).body)).toEqual([]);
      expect((await list({ bankDetailsId: slotted })).body.meta.total).toBe(3);

      const summary = await e2e.http
        .get('/trader/counterparties/summary')
        .set(bearer(pageTrader))
        .expect(200);
      expect(summary.body.data).toEqual({
        total: 3,
        averageConversion: 50,
        deposits30d: '13000.00',
        averageCheck: '6500.00',
      });
      const groups = await e2e.http
        .get('/trader/counterparties/groups')
        .set(bearer(pageTrader))
        .expect(200);
      const groupOf = (id: string) =>
        (
          groups.body.data as {
            requisite: { id: string };
            slots: { bound: number; max: number };
            deposits30d: string;
          }[]
        ).find((row) => row.requisite.id === id);
      expect(groupOf(slotted)).toMatchObject({
        slots: { bound: 3, max: 5 },
        deposits30d: '13000.00',
      });
      expect(groupOf(empty)).toMatchObject({
        slots: { bound: 0, max: 1 },
        deposits30d: '0.00',
      });

      const snapshot = async () => {
        const totals = await e2e.dataSource
          .getRepository(CounterpartyTraderStats)
          .find({ order: { counterpartyId: 'ASC', traderUserId: 'ASC' } });
        const days = await e2e.dataSource
          .getRepository(CounterpartyTraderDailyVolume)
          .find({
            order: { counterpartyId: 'ASC', traderUserId: 'ASC', day: 'ASC' },
          });

        return {
          totals: totals.map((row) => ({
            counterpartyId: row.counterpartyId,
            traderUserId: row.traderUserId,
            completedCount: row.completedCount,
            paidCount: row.paidCount,
            paidAmount: row.paidAmount.toFixed(2),
            lastPaidAt: row.lastPaidAt?.toISOString() ?? null,
            lastDealAt: row.lastDealAt?.toISOString() ?? null,
          })),
          days: days.map((row) => ({
            counterpartyId: row.counterpartyId,
            traderUserId: row.traderUserId,
            day: row.day,
            paidCount: row.paidCount,
            paidAmount: row.paidAmount.toFixed(2),
          })),
        };
      };
      const clientSnapshot = async () => {
        const rows = await e2e.dataSource
          .getRepository(Counterparty)
          .find({ order: { id: 'ASC' } });
        const days = await e2e.dataSource
          .getRepository(CounterpartyDailyVolume)
          .find({ order: { counterpartyId: 'ASC', day: 'ASC' } });

        return {
          rows: rows.map((row) => ({
            id: row.id,
            dealCount: row.dealCount,
            completedCount: row.completedCount,
            paidCount: row.paidCount,
            disputeCount: row.disputeCount,
            paidAmount: row.paidAmount.toFixed(2),
            lastDepositAt: row.lastDepositAt?.toISOString() ?? null,
          })),
          days: days.map((row) => ({
            counterpartyId: row.counterpartyId,
            day: row.day,
            paidCount: row.paidCount,
            paidAmount: row.paidAmount.toFixed(2),
          })),
        };
      };
      const cards = async (ids: number[]) =>
        Promise.all(
          ids.map(async (id) => {
            const card = await e2e.app
              .get(CounterpartyDealStatsService)
              .statsOf(id, undefined, new Date());

            return {
              id,
              dealCount: card.dealCount,
              completedCount: card.completedCount,
              paidCount: card.paidCount,
              disputeCount: card.disputeCount,
              paidAmount: card.paidAmount.toFixed(2),
              lastDepositAt: card.lastDepositAt?.toISOString() ?? null,
            };
          }),
        );
      const evidence = async (id: string): Promise<string> =>
        (
          await e2e.http
            .post('/v1/files')
            .set('X-Secure-Key', key)
            .field('dealId', id)
            .attach(
              'file',
              Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'),
              'чек.pdf',
            )
            .expect(201)
        ).body.data.fileKey as string;
      const dispute = async (id: string, amount?: string) =>
        e2e.http
          .post(`/v1/payment/${id}/dispute`)
          .set('X-Secure-Key', key)
          .send({
            fileKeys: [await evidence(id)],
            ...(amount === undefined ? {} : { amount }),
          })
          .expect(200);

      const changed = await payIn('page-d', '5500');
      await e2e.http
        .post(`/trader/deals/${changed}/confirm-changed`)
        .set(bearer(pageTrader))
        .send({ amount: '5600' })
        .expect(200);
      expect((await deal(changed)).amountFiat.toFixed(2)).toBe('5600.00');
      const d = (await client('page-d')).id;

      await dispute(settledA, '6500');
      await dispute(canceledC);
      expect((await deal(settledA)).status).toBe('dispute');
      expect((await deal(canceledC)).status).toBe('dispute');

      const live = await snapshot();
      const liveClients = await clientSnapshot();
      expect(await cards(liveClients.rows.map((row) => row.id))).toEqual(
        liveClients.rows,
      );
      expect(live.totals.length).toBeGreaterThanOrEqual(5);
      expect(
        live.totals.find(
          (row) =>
            row.counterpartyId === a && row.traderUserId === pageTrader.user.id,
        ),
      ).toMatchObject({
        completedCount: 1,
        paidCount: 1,
        paidAmount: '6000.00',
      });
      expect(
        live.totals.find(
          (row) =>
            row.counterpartyId === c && row.traderUserId === pageTrader.user.id,
        ),
      ).toMatchObject({ completedCount: 1, paidCount: 0 });
      expect(live.totals.find((row) => row.counterpartyId === d)).toMatchObject(
        { paidCount: 1, paidAmount: '5600.00' },
      );
      await e2e.app
        .get(CounterpartyDealStatsService)
        .rebuildCounterpartyStats();
      expect(await snapshot()).toEqual(live);
      expect(await clientSnapshot()).toEqual(liveClients);

      for (const id of [settledA, canceledC]) {
        const row = await e2e.dataSource
          .getRepository(TransactionDispute)
          .findOneOrFail({
            where: { transactionId: id },
            order: { id: 'DESC' },
          });
        await e2e.http
          .post(`/admin/disputes/${row.id}/accept`)
          .set(bearer(admin))
          .send({})
          .expect(200);
      }
      expect((await deal(settledA)).status).toBe('success_changed');
      expect((await deal(canceledC)).status).toBe('success');

      const decided = await snapshot();
      const decidedClients = await clientSnapshot();
      expect(await cards(decidedClients.rows.map((row) => row.id))).toEqual(
        decidedClients.rows,
      );
      expect(
        decided.totals.find(
          (row) =>
            row.counterpartyId === a && row.traderUserId === pageTrader.user.id,
        ),
      ).toMatchObject({
        completedCount: 1,
        paidCount: 1,
        paidAmount: '6500.00',
      });
      expect(
        decided.totals.find(
          (row) =>
            row.counterpartyId === c && row.traderUserId === pageTrader.user.id,
        ),
      ).toMatchObject({ completedCount: 1, paidCount: 1 });
      await e2e.app
        .get(CounterpartyDealStatsService)
        .rebuildCounterpartyStats();
      expect(await snapshot()).toEqual(decided);
      expect(await clientSnapshot()).toEqual(decidedClients);

      await settings.update(
        { userId: trader.user.id },
        { tradingEnabled: true },
      );
      await settings.update(
        { userId: pageTrader.user.id },
        { tradingEnabled: false },
      );
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
    it('lists the trader’s own sign-ins and switches, of an admin’s only the money events, with no IP and no admin', async () => {
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

      const audit = e2e.app.get(AuditService);
      for (const action of [
        'activity.deposit_credited',
        'activity.withdrawal_completed',
        'activity.bank_details_added',
      ]) {
        await audit.record({
          actorUserId: admin.user.id,
          targetUserId: trader.user.id,
          action,
          metadata: {
            accountTransactionId: 77,
            amount: '50.000000',
            fee: '1.000000',
            id: 'by-the-admin',
          },
        });
      }
      const withMoney = await e2e.http
        .get('/trader/activity')
        .set(bearer(trader))
        .query({ limit: 100 })
        .expect(200);
      const rows = withMoney.body.data as {
        action: string;
        details: Record<string, unknown>;
      }[];
      expect(rows.slice(0, 2)).toEqual([
        expect.objectContaining({
          action: 'activity.withdrawal_completed',
          details: { amount: '50.000000', fee: '1.000000' },
        }),
        expect.objectContaining({
          action: 'activity.deposit_credited',
          details: { amount: '50.000000' },
        }),
      ]);
      expect(rows.some((row) => row.details.id === 'by-the-admin')).toBe(false);
      expect(withMoney.body.meta.total).toBe(feed.body.meta.total + 2);
      expect(JSON.stringify(withMoney.body)).not.toContain(admin.user.id);
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
      for (const field of ['threshold', 'method', 'limitType']) {
        await put([
          {
            type:
              field === 'threshold'
                ? 'balance_below_threshold'
                : 'requisite_limit_reached',
            enabled: false,
            [field]: null,
          },
        ]).expect(400);
      }

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

      const stored = () =>
        e2e.dataSource.getRepository(NotificationSetting).findOneByOrFail({
          userId: trader.user.id,
          type: NotificationType.BalanceBelowThreshold,
        });
      const before = await stored();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await put([
        { type: 'balance_below_threshold', enabled: true, threshold: '150.5' },
      ]).expect(200);
      const after = await stored();
      expect(after.id).toBe(before.id);
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );

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
