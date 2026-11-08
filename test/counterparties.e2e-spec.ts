import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { toRate } from '../src/common/utils/to-rate';
import { CounterpartiesService } from '../src/counterparties/services/counterparties.service';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { CounterpartyDealStatsService } from '../src/transactions/services/counterparty-deal-stats.service';
import { TransactionService } from '../src/transactions/services/transaction.service';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';
import { deviceOf } from './support/device-of';

describe('the counterparties page', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let merchantId: string;
  let bankId: number;
  let deviceId: number;
  let sbpRequisite: string;
  let cardRequisite: string;
  let plainRequisite: string;
  let first: number;
  let second: number;

  const card = async (id: number) =>
    (
      await e2e.http
        .get(`/admin/counterparties/${id}`)
        .set(bearer(admin))
        .expect(200)
    ).body.data;

  const list = async (query = '') =>
    (
      await e2e.http
        .get(`/admin/counterparties${query}`)
        .set(bearer(admin))
        .expect(200)
    ).body;

  const requisite = async (body: Record<string, unknown>) =>
    (
      await e2e.http
        .post('/trader/requisites')
        .set(bearer(trader))
        .send({
          bankId,
          deviceId,
          dailyAmountLimit: '300000.00',
          ...(body.counterpartyOnly ? { maxCounterparties: 8 } : {}),
          ...body,
        })
        .expect(201)
    ).body.data.id as string;

  const move = async (id: string, statuses: string[]) => {
    for (const status of statuses) {
      await e2e.http
        .patch(`/admin/transactions/${id}/status`)
        .set(bearer(admin))
        .send({ status })
        .expect(200);
    }
  };

  const payIn = async (
    counterpartyId: number | null,
    amount: number,
    kind = TransactionKind.PayIn,
  ) =>
    (
      await e2e.app.get(TransactionService).createDeal({
        kind,
        method: 'sbp',
        traderUserId: trader.user.id,
        bankDetailsId: sbpRequisite,
        merchantId: kind === TransactionKind.PayIn ? merchantId : undefined,
        counterpartyId,
        amountFiat: toFiat(amount),
        rate: toRate(90),
        merchantPercent: 10,
        traderPercent: 7,
      })
    ).id;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    deviceId = await deviceOf(e2e, trader);
    merchantId = (await e2e.app.get(MerchantsService).create('Мерчант A7')).id;

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
          name: 'Т-банк',
          countryId: country.body.data.id,
          currencyId: currency.body.data.id,
          transactionTypes: ['card', 'sbp'],
        })
        .expect(201)
    ).body.data.id;

    sbpRequisite = await requisite({
      type: 'card_or_sbp',
      phone: '+79012345678',
      cardholderName: 'Шевченко Д.',
      counterpartyOnly: true,
    });
    cardRequisite = await requisite({
      type: 'card_or_sbp',
      card: '4276000033335654',
      counterpartyOnly: true,
    });
    plainRequisite = await requisite({
      type: 'card_or_sbp',
      phone: '+79010000000',
    });

    await e2e.dataSource
      .getRepository(Wallet)
      .save({ userId: trader.user.id, mainBalance: toCrypto(100000) });

    const counterparties = e2e.app.get(CounterpartiesService);
    first = (await counterparties.findOrCreate(merchantId, '1234451241')).id;
    second = (await counterparties.findOrCreate(merchantId, '9990001')).id;
  });

  afterAll(() => e2e?.close());

  it('counts the deals of a counterparty as they move, and the rebuild agrees', async () => {
    await move(await payIn(first, 1000), ['success']);
    await move(await payIn(first, 2000), ['canceled']);
    await move(await payIn(first, 3000.5), [
      'dispute',
      'manual_review',
      'success_changed',
    ]);
    await payIn(first, 500);
    await move(await payIn(second, 100), ['success']);
    await move(await payIn(first, 7000, TransactionKind.PayOut), [
      'active',
      'success',
    ]);

    const counted = await card(first);
    expect(counted).toMatchObject({
      dealCount: 4,
      completedCount: 3,
      paidCount: 2,
      disputes: 1,
      conversion: 66.67,
      averageCheck: '2000.25',
      volume7d: '4000.50',
      volume30d: '4000.50',
      volumeTotal: '4000.50',
      currency: 'RUB',
      requestCount: 0,
    });
    expect(counted.lastDepositAt).not.toBeNull();

    const stats = (
      await e2e.http
        .get(`/admin/counterparties/${first}/stats`)
        .set(bearer(admin))
        .expect(200)
    ).body.data;
    expect(stats).toMatchObject({
      method: null,
      conversion: 66.67,
      paidCount: 2,
      completedCount: 3,
      disputes: 1,
      averageCheck: '2000.25',
      funnel: { requests: 0, deals: 4, paid: 2 },
      volume7d: '4000.50',
      volumeTotal: '4000.50',
    });
    const card7 = (
      await e2e.http
        .get(`/admin/counterparties/${first}/stats?method=card`)
        .set(bearer(admin))
        .expect(200)
    ).body.data;
    expect(card7.funnel.deals).toBe(0);
    await e2e.http
      .get(`/admin/counterparties/${first}/stats?method=crypto`)
      .set(bearer(admin))
      .expect(400);

    await e2e.app.get(CounterpartyDealStatsService).rebuildCounterpartyStats();
    const rebuilt = await card(first);
    for (const field of [
      'dealCount',
      'completedCount',
      'paidCount',
      'disputes',
      'volume7d',
      'volume30d',
      'volumeTotal',
      'lastDepositAt',
    ]) {
      expect(rebuilt[field]).toEqual(counted[field]);
    }

    const events = await e2e.http
      .get(`/admin/counterparties/${first}/deal-events?limit=100`)
      .set(bearer(admin))
      .expect(200);
    expect(events.body.meta.total).toBe(12);
    expect(events.body.data[0].trader.id).toBe(trader.user.id);
  });

  it('sorts and filters on the counters in SQL', async () => {
    const byVolume = await list('?sortBy=volumeTotal&sortOrder=desc');
    expect(byVolume.data.map((row: { id: number }) => row.id)).toEqual([
      first,
      second,
    ]);
    const byConversion = await list('?sortBy=conversion&sortOrder=asc');
    expect(byConversion.data.map((row: { id: number }) => row.id)).toEqual([
      first,
      second,
    ]);
    for (const sortBy of [
      'activity',
      'averageCheck',
      'volume7d',
      'volume30d',
      'externalId',
      'id',
    ]) {
      await list(`?sortBy=${sortBy}`);
    }

    expect((await list('?volume7dFrom=1000.00')).meta.total).toBe(1);
    expect((await list('?volume90dTo=100.00')).meta.total).toBe(1);
    expect(
      (await list('?volumeTotalFrom=4000.50&volumeTotalTo=4000.50')).meta.total,
    ).toBe(1);
    expect((await list('?paid30dFrom=2')).meta.total).toBe(1);
    expect((await list('?search=12344_')).meta.total).toBe(0);
    expect((await list('?search=4451')).data[0].id).toBe(first);
    expect((await list(`?merchantId=${merchantId}`)).meta.total).toBe(2);

    await e2e.http
      .get('/admin/counterparties?volume7dFrom=10&volume7dTo=5')
      .set(bearer(admin))
      .expect(400);
    await e2e.http
      .get('/admin/counterparties?volume7dFrom=1.234')
      .set(bearer(admin))
      .expect(400);
    expect(
      (await list(`?merchantId=${merchantId}&requests30dFrom=1`)).meta.total,
    ).toBe(0);
    expect(
      (await list(`?merchantId=${merchantId}&requests30dTo=0`)).meta.total,
    ).toBe(2);
    await e2e.http
      .get('/admin/counterparties?requests30dFrom=3&requests30dTo=1')
      .set(bearer(admin))
      .expect(400);
  });

  it('binds, replaces and unbinds a counterparty-only requisite', async () => {
    const bind = (body: Record<string, unknown>, id = first) =>
      e2e.http
        .post(`/admin/counterparties/${id}/requisite`)
        .set(bearer(admin))
        .send(body);

    await bind({ bankDetailsId: plainRequisite, bindingType: 'sbp' }).expect(
      409,
    );
    await bind({ bankDetailsId: sbpRequisite, bindingType: 'cards' }).expect(
      400,
    );
    await bind({ bankDetailsId: sbpRequisite, bindingType: 'nope' }).expect(
      400,
    );
    await bind({
      bankDetailsId: '00000000-0000-4000-8000-000000000000',
      bindingType: 'sbp',
    }).expect(404);
    await bind(
      { bankDetailsId: sbpRequisite, bindingType: 'sbp' },
      999999,
    ).expect(404);

    const bound = await bind({
      bankDetailsId: sbpRequisite,
      bindingType: 'cards_or_sbp',
    }).expect(201);
    expect(bound.body.data.binding).toMatchObject({
      bindingType: 'cards_or_sbp',
      requisite: {
        id: sbpRequisite,
        phone: '+79012345678',
        bank: { name: 'Т-банк' },
        trader: { id: trader.user.id },
      },
    });
    await bind({ bankDetailsId: cardRequisite, bindingType: 'cards' }).expect(
      409,
    );

    expect((await list('?hasRequisite=true')).data[0].id).toBe(first);
    expect((await list(`?traderUserId=${trader.user.id}`)).meta.total).toBe(1);
    expect((await list(`?bankDetailsId=${cardRequisite}`)).meta.total).toBe(0);
    expect((await list('?search=Шевченко')).data[0].id).toBe(first);

    await e2e.http
      .put(`/admin/counterparties/${first}/requisite`)
      .set(bearer(admin))
      .send({ bankDetailsId: sbpRequisite })
      .expect(409);
    const replaced = await e2e.http
      .put(`/admin/counterparties/${first}/requisite`)
      .set(bearer(admin))
      .send({ bankDetailsId: cardRequisite })
      .expect(200);
    expect(replaced.body.data.binding.requisite.id).toBe(cardRequisite);

    await e2e.http
      .delete(`/admin/counterparties/${first}/requisite`)
      .set(bearer(admin))
      .expect(200);
    await e2e.http
      .delete(`/admin/counterparties/${first}/requisite`)
      .set(bearer(admin))
      .expect(404);

    const events = (
      await e2e.http
        .get(`/admin/counterparties/${first}/requisite-events`)
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(
      events.data.map((row: { kind: string; reason: string | null }) => [
        row.kind,
        row.reason,
      ]),
    ).toEqual([
      ['unbound', null],
      ['bound', 'replaced'],
      ['unbound', 'replaced'],
      ['bound', null],
    ]);
    expect(events.data[0].actor.id).toBe(admin.user.id);
  });

  it('unbinds by itself when the trader deletes the requisite or drops the flag', async () => {
    await e2e.http
      .post(`/admin/counterparties/${second}/requisite`)
      .set(bearer(admin))
      .send({ bankDetailsId: cardRequisite, bindingType: 'cards' })
      .expect(201);
    await e2e.http
      .patch(`/trader/requisites/${cardRequisite}`)
      .set(bearer(trader))
      .send({ counterpartyOnly: false })
      .expect(200);
    expect((await card(second)).binding).toBeNull();

    await e2e.http
      .post(`/admin/counterparties/${second}/requisite`)
      .set(bearer(admin))
      .send({ bankDetailsId: sbpRequisite, bindingType: 'sbp' })
      .expect(201);
    await e2e.http
      .delete(`/trader/requisites/${sbpRequisite}`)
      .set(bearer(trader))
      .expect(200);
    expect((await card(second)).binding).toBeNull();

    const events = (
      await e2e.http
        .get(`/admin/counterparties/${second}/requisite-events`)
        .set(bearer(admin))
        .expect(200)
    ).body.data;
    expect(
      events
        .filter((row: { source: string }) => row.source === 'system')
        .map((row: { reason: string; actor: unknown }) => [
          row.reason,
          row.actor,
        ]),
    ).toEqual([
      ['requisite_deleted', null],
      ['counterparty_only_cleared', null],
    ]);
  });

  it('blacklists, which disables, and never enables while blacklisted', async () => {
    const patch = (body: Record<string, unknown>) =>
      e2e.http
        .patch(`/admin/counterparties/${first}`)
        .set(bearer(admin))
        .send(body);

    await patch({}).expect(400);
    await patch({ enabled: 'yes' }).expect(400);
    const blacklisted = await patch({
      blacklisted: true,
      reason: 'fraud',
    }).expect(200);
    expect(blacklisted.body.data).toMatchObject({
      blacklisted: true,
      enabled: false,
      health: 'blacklisted',
    });
    await patch({ enabled: true }).expect(409);
    await patch({ blacklisted: false, enabled: true }).expect(200);
    await patch({ blacklisted: true }).expect(200);
    const left = await patch({ blacklisted: false }).expect(200);
    expect(left.body.data).toMatchObject({
      blacklisted: false,
      enabled: false,
    });
    await patch({ autoEnableForbidden: true }).expect(200);

    expect((await list('?status=disabled')).data[0].id).toBe(first);
    expect((await list('?autoEnableForbidden=true')).meta.total).toBe(1);
    const counts = (
      await e2e.http
        .get('/admin/counterparties/counts?status=enabled')
        .set(bearer(admin))
        .expect(200)
    ).body.data;
    expect(counts).toEqual({ all: 2, enabled: 1, disabled: 1 });
  });

  it('offers only counterparty-only requisites for binding', async () => {
    const offered = (
      await e2e.http
        .get('/admin/counterparty-requisites')
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(offered.data.map((row: { id: string }) => row.id)).toEqual([]);

    const another = await requisite({
      type: 'card_or_sbp',
      phone: '+79015550000',
      cardholderName: 'Сергеев С.',
      counterpartyOnly: true,
    });
    const found = (
      await e2e.http
        .get('/admin/counterparty-requisites?search=Сергеев&type=card_or_sbp')
        .set(bearer(admin))
        .expect(200)
    ).body.data;
    expect(found.map((row: { id: string }) => row.id)).toEqual([another]);
  });

  it('refuses everyone but an admin, and bad ids', async () => {
    await e2e.http.get('/admin/counterparties').set(bearer(trader)).expect(403);
    await e2e.http.get('/admin/counterparties').expect(401);
    await e2e.http
      .get('/admin/counterparties/2147483648')
      .set(bearer(admin))
      .expect(400);
    await e2e.http
      .get('/admin/counterparties/abc')
      .set(bearer(admin))
      .expect(400);
    await e2e.http
      .get('/admin/counterparties/999999')
      .set(bearer(admin))
      .expect(404);
  });
});
