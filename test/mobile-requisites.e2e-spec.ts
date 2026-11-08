import { Role } from '../src/common/enums/role.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { deviceOf } from './support/device-of';
import { bearer } from './support/flow';

describe('mobile operators and the two requisite types', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let countryId: number;
  let bankId: number;
  let operatorId: number;
  let deviceId: number;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    deviceId = await deviceOf(e2e, trader);

    countryId = (
      await e2e.http
        .post('/admin/countries')
        .set(bearer(admin))
        .send({ name: 'Россия' })
        .expect(201)
    ).body.data.id;
    const currency = await e2e.http
      .post('/admin/currencies')
      .set(bearer(admin))
      .send({ name: 'Рубль', isocode: 'RUB', countryId })
      .expect(201);
    bankId = (
      await e2e.http
        .post('/admin/banks')
        .set(bearer(admin))
        .send({
          bankId: 'tbank',
          name: 'Т-банк',
          countryId,
          currencyId: currency.body.data.id,
          transactionTypes: ['card', 'sbp'],
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(() => e2e?.close());

  it('lets an admin add, read, list and retire a mobile operator', async () => {
    const created = await e2e.http
      .post('/admin/mobile-operators')
      .set(bearer(admin))
      .send({ code: ' mts ', name: 'МТС', countryId })
      .expect(201);
    expect(created.body.data).toMatchObject({
      code: 'mts',
      name: 'МТС',
      countryId,
      country: { id: countryId, name: 'Россия' },
      active: true,
    });
    operatorId = created.body.data.id;

    await e2e.http
      .post('/admin/mobile-operators')
      .set(bearer(admin))
      .send({ code: 'mts', name: 'Другой', countryId })
      .expect(409);
    await e2e.http
      .post('/admin/mobile-operators')
      .set(bearer(admin))
      .send({ code: 'beeline', name: 'Билайн', countryId: 999999 })
      .expect(400);
    await e2e.http
      .post('/admin/mobile-operators')
      .set(bearer(admin))
      .send({ code: 'beeline', name: 'Билайн', countryId })
      .expect(201);

    await e2e.http
      .get(`/admin/mobile-operators/${operatorId}`)
      .set(bearer(admin))
      .expect(200);
    await e2e.http
      .get('/admin/mobile-operators/999999')
      .set(bearer(admin))
      .expect(404);

    const searched = await e2e.http
      .get('/admin/mobile-operators?search=mt&sortBy=code')
      .set(bearer(admin))
      .expect(200);
    expect(searched.body.data.map((row: { code: string }) => row.code)).toEqual(
      ['mts'],
    );
    expect(searched.body.meta).toMatchObject({ total: 1, page: 1 });

    await e2e.http
      .patch(`/admin/mobile-operators/${operatorId}`)
      .set(bearer(admin))
      .send({})
      .expect(400);
    const beeline = (
      await e2e.http
        .get('/admin/mobile-operators?search=beeline')
        .set(bearer(admin))
        .expect(200)
    ).body.data[0];
    await e2e.http
      .patch(`/admin/mobile-operators/${beeline.id}`)
      .set(bearer(admin))
      .send({ active: false })
      .expect(200);
    const inactive = await e2e.http
      .get('/admin/mobile-operators?active=false')
      .set(bearer(admin))
      .expect(200);
    expect(inactive.body.data.map((row: { code: string }) => row.code)).toEqual(
      ['beeline'],
    );

    await e2e.http
      .get('/admin/mobile-operators')
      .set(bearer(trader))
      .expect(403);
  });

  it('creates a mobile requisite without a bank', async () => {
    const created = await e2e.http
      .post('/trader/requisites')
      .set(bearer(trader))
      .send({
        deviceId,
        dailyAmountLimit: '300000.00',
        type: 'mobile',
        phone: '+79161234567',
        mobileOperatorId: operatorId,
        cardholderName: 'IVAN PETROV',
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      type: 'mobile',
      bankId: null,
      bank: null,
      card: null,
      phone: '+79161234567',
      mobileOperatorId: operatorId,
      mobileOperator: { id: operatorId, code: 'mts' },
    });

    const listed = await e2e.http
      .get('/admin/bank-details?type=mobile')
      .set(bearer(admin))
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        id: created.body.data.id,
        bank: null,
        mobileOperator: { id: operatorId, code: 'mts', name: 'МТС' },
      }),
    ]);
  });

  it('refuses a mobile requisite without a phone, without an operator or with a bank', async () => {
    const refused = (body: Record<string, unknown>) =>
      e2e.http
        .post('/trader/requisites')
        .set(bearer(trader))
        .send({
          deviceId,
          dailyAmountLimit: '300000.00',
          type: 'mobile',
          ...body,
        })
        .expect(400);

    await refused({ mobileOperatorId: operatorId });
    await refused({ phone: '+79161234567' });
    await refused({
      phone: '+79161234567',
      mobileOperatorId: operatorId,
      bankId,
    });
    await refused({ phone: '+79161234567', mobileOperatorId: 999999 });
  });

  it('refuses a card-or-sbp requisite with neither a card nor a phone, or without a bank', async () => {
    await e2e.http
      .post('/trader/requisites')
      .set(bearer(trader))
      .send({
        deviceId,
        dailyAmountLimit: '300000.00',
        type: 'card_or_sbp',
        bankId,
        cardholderName: 'IVAN PETROV',
      })
      .expect(400);
    await e2e.http
      .post('/trader/requisites')
      .set(bearer(trader))
      .send({
        deviceId,
        dailyAmountLimit: '300000.00',
        type: 'card_or_sbp',
        card: '4276000011112222',
      })
      .expect(400);
    await e2e.http
      .post('/trader/requisites')
      .set(bearer(trader))
      .send({
        deviceId,
        dailyAmountLimit: '300000.00',
        type: 'card',
        bankId,
        card: '4276000011112222',
      })
      .expect(400);
  });

  it('carries a card and a phone on one requisite, and moves it between the types', async () => {
    const created = await e2e.http
      .post('/trader/requisites')
      .set(bearer(trader))
      .send({
        deviceId,
        dailyAmountLimit: '300000.00',
        type: 'card_or_sbp',
        bankId,
        card: '4276000011112222',
        phone: '+79260000000',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      card: '4276000011112222',
      phone: '+79260000000',
      bank: { id: bankId },
      mobileOperator: null,
    });
    const id = created.body.data.id as string;

    const mobile = await e2e.http
      .patch(`/trader/requisites/${id}`)
      .set(bearer(trader))
      .send({ type: 'mobile', mobileOperatorId: operatorId })
      .expect(200);
    expect(mobile.body.data).toMatchObject({
      type: 'mobile',
      bankId: null,
      bank: null,
      card: null,
      phone: '+79260000000',
      mobileOperatorId: operatorId,
    });

    const back = await e2e.http
      .patch(`/trader/requisites/${id}`)
      .set(bearer(trader))
      .send({ type: 'card_or_sbp', bankId })
      .expect(200);
    expect(back.body.data).toMatchObject({
      type: 'card_or_sbp',
      bankId,
      bank: { id: bankId },
      mobileOperatorId: null,
      mobileOperator: null,
    });
  });
});
