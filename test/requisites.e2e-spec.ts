import { Role } from '../src/common/enums/role.enum';
import { CounterpartiesService } from '../src/counterparties/services/counterparties.service';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('the trader’s requisites (TC07)', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let stranger: E2eUser;
  let bankId: number;
  let deviceId: number;

  const create = (body: Record<string, unknown>, as: E2eUser = trader) =>
    e2e.http
      .post('/bank-details')
      .set(bearer(as))
      .send({
        type: 'card_or_sbp',
        bankId,
        deviceId,
        dailyAmountLimit: '300000.00',
        phone: '+79012345678',
        ...body,
      });

  const createTag = async (name: string, as: E2eUser = trader) =>
    (
      await e2e.http
        .post('/bank-details/tags')
        .set(bearer(as))
        .send({ name })
        .expect(201)
    ).body.data.id as number;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    stranger = await e2e.createUser(Role.Trader);
    deviceId = await deviceOf(e2e, trader);

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
          bankId: 'sber',
          name: 'Сбербанк',
          countryId: country.body.data.id,
          currencyId: currency.body.data.id,
          transactionTypes: ['card', 'sbp'],
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(() => e2e.close());

  it('requires a device and the daily limit, and takes the delay only from the set', async () => {
    await create({ deviceId: undefined }).expect(400);
    await create({ dailyAmountLimit: undefined }).expect(400);
    await create({ dailyAmountLimitEnabled: false }).expect(400);
    await create({ deviceId: await deviceOf(e2e, stranger) }).expect(400);
    await create({
      delayBetweenRequestsEnabled: true,
      delayBetweenRequests: 120,
    }).expect(400);
    await create({ counterpartyOnly: true }).expect(400);
    await create({ maxCounterparties: 2 }).expect(400);

    const created = await create({
      delayBetweenRequestsEnabled: true,
      delayBetweenRequests: 300,
      hourlyAmountLimitEnabled: true,
      hourlyAmountLimit: '50000.00',
      sameBankOnly: true,
    }).expect(201);
    expect(created.body.data).toMatchObject({
      deviceId,
      dailyAmountLimitEnabled: true,
      dailyAmountLimit: '300000.00',
      delayBetweenRequests: 300,
      hourlyAmountLimitEnabled: true,
      hourlyAmountLimit: '50000.00',
      sameBankOnly: true,
      maxCounterparties: null,
      boundCounterparties: 0,
      status: 'active',
      tags: [],
      turnoverTotal: '0.00',
      turnoverToday: '0.00',
      turnoverMonth: '0.00',
      dealsToday: 0,
      lastHourAmount: '0.00',
    });

    await e2e.http
      .patch(`/bank-details/${created.body.data.id}`)
      .set(bearer(trader))
      .send({ dailyAmountLimitEnabled: false })
      .expect(400);
  });

  it('refuses a counterparty beyond the requisite’s slots with 409', async () => {
    const requisite = (
      await create({ counterpartyOnly: true, maxCounterparties: 1 }).expect(201)
    ).body.data.id as string;
    const merchantId = (
      await e2e.app.get(MerchantsService).create('Мерчант TC07')
    ).id;
    const counterparties = e2e.app.get(CounterpartiesService);
    const first = (await counterparties.findOrCreate(merchantId, 'c-1')).id;
    const second = (await counterparties.findOrCreate(merchantId, 'c-2')).id;
    const bind = (id: number) =>
      e2e.http
        .post(`/admin/counterparties/${id}/requisite`)
        .set(bearer(admin))
        .send({ bankDetailsId: requisite, bindingType: 'sbp' });

    await bind(first).expect(201);
    await bind(second).expect(409);

    const row = await e2e.http
      .get(`/bank-details/${requisite}`)
      .set(bearer(trader))
      .expect(200);
    expect(row.body.data).toMatchObject({
      maxCounterparties: 1,
      boundCounterparties: 1,
    });
    const adminRow = await e2e.http
      .get(`/admin/bank-details/${requisite}`)
      .set(bearer(admin))
      .expect(200);
    expect(adminRow.body.data.boundCounterparties).toBe(1);

    await e2e.http
      .patch(`/bank-details/${requisite}`)
      .set(bearer(trader))
      .send({ maxCounterparties: 2 })
      .expect(200);
    await bind(second).expect(201);
  });

  it('keeps tags per trader: another trader’s tag is a 404, and the list filters by tag', async () => {
    const own = await createTag('Сбер основные');
    const theirs = await createTag('Чужой', stranger);

    await e2e.http
      .post('/bank-details/tags')
      .set(bearer(trader))
      .send({ name: 'СБЕР ОСНОВНЫЕ' })
      .expect(409);
    await create({ tagIds: [theirs] }).expect(404);
    await e2e.http
      .delete(`/bank-details/tags/${theirs}`)
      .set(bearer(trader))
      .expect(404);

    const tagged = (await create({ tagIds: [own] }).expect(201)).body.data;
    expect(tagged.tags).toEqual([{ id: own, name: 'Сбер основные' }]);

    const listed = await e2e.http
      .get(`/bank-details?tagId=${own}`)
      .set(bearer(trader))
      .expect(200);
    expect(listed.body.data.map((row: { id: string }) => row.id)).toEqual([
      tagged.id,
    ]);

    const tags = await e2e.http
      .get('/bank-details/tags')
      .set(bearer(trader))
      .expect(200);
    expect(tags.body.data.map((tag: { id: number }) => tag.id)).toEqual([own]);

    await e2e.http
      .patch(`/bank-details/${tagged.id}`)
      .set(bearer(trader))
      .send({ tagIds: [] })
      .expect(200);
    await e2e.http
      .delete(`/bank-details/tags/${own}`)
      .set(bearer(trader))
      .expect(200);
  });

  it('counts the tabs and filters by status', async () => {
    const id = (await create({ phone: '+79019990000' }).expect(201)).body.data
      .id as string;
    await e2e.http
      .post(`/bank-details/${id}/disable`)
      .set(bearer(trader))
      .expect(200);

    const counts = (
      await e2e.http.get('/bank-details/counts').set(bearer(trader)).expect(200)
    ).body.data;
    expect(counts.disabled).toBe(1);
    expect(counts.all).toBe(counts.active + counts.disabled + counts.banned);

    const disabled = await e2e.http
      .get('/bank-details?status=disabled')
      .set(bearer(trader))
      .expect(200);
    expect(disabled.body.data.map((row: { id: string }) => row.id)).toEqual([
      id,
    ]);
  });

  it('keeps a history of requisite actions with an unread count', async () => {
    await e2e.http
      .post('/bank-details/history/read')
      .set(bearer(trader))
      .expect(200);
    expect(
      (
        await e2e.http
          .get('/bank-details/history/unread')
          .set(bearer(trader))
          .expect(200)
      ).body.data.unreadCount,
    ).toBe(0);

    const id = (await create({ phone: '+79017770000' }).expect(201)).body.data
      .id as string;
    await e2e.http
      .patch(`/bank-details/${id}`)
      .set(bearer(trader))
      .send({ reserve: true })
      .expect(200);
    await e2e.http
      .patch(`/admin/bank-details/${id}`)
      .set(bearer(admin))
      .send({ banned: true })
      .expect(200);

    const state = await e2e.http
      .get('/bank-details/history/unread')
      .set(bearer(trader))
      .expect(200);
    expect(state.body.data.unreadCount).toBe(3);

    const history = await e2e.http
      .get('/bank-details/history?limit=3')
      .set(bearer(trader))
      .expect(200);
    expect(
      history.body.data.map(
        (row: { action: string; actor: string; unread: boolean }) => [
          row.action,
          row.actor,
          row.unread,
        ],
      ),
    ).toEqual([
      ['bank_details.banned', 'admin', true],
      ['bank_details.updated', 'trader', true],
      ['activity.bank_details_added', 'trader', true],
    ]);
    expect(history.body.data[0].bankDetailsId).toBe(id);

    await e2e.http
      .post('/bank-details/history/read')
      .set(bearer(trader))
      .expect(200);
    const after = await e2e.http
      .get('/bank-details/history?limit=1')
      .set(bearer(trader))
      .expect(200);
    expect(after.body.data[0].unread).toBe(false);

    const strangers = await e2e.http
      .get('/bank-details/history')
      .set(bearer(stranger))
      .expect(200);
    expect(strangers.body.meta.total).toBe(0);
  });

  it('switches a deleted device’s requisites off, refuses to enable them, and takes them back on another device', async () => {
    const doomed = await deviceOf(e2e, trader);
    const id = (await create({ deviceId: doomed }).expect(201)).body.data
      .id as string;

    await e2e.http.delete(`/devices/${doomed}`).set(bearer(trader)).expect(200);

    const row = await e2e.http
      .get(`/bank-details/${id}`)
      .set(bearer(trader))
      .expect(200);
    expect(row.body.data).toMatchObject({
      deviceId: doomed,
      active: false,
      status: 'disabled',
    });

    await e2e.http
      .post(`/bank-details/${id}/enable`)
      .set(bearer(trader))
      .expect(409);
    await e2e.http
      .post(`/admin/bank-details/${id}/enable`)
      .set(bearer(admin))
      .expect(409);

    await e2e.http
      .patch(`/bank-details/${id}`)
      .set(bearer(trader))
      .send({ deviceId })
      .expect(200);
    await e2e.http
      .post(`/bank-details/${id}/enable`)
      .set(bearer(trader))
      .expect(200);
  });
});
