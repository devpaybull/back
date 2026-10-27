import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { toRate } from '../src/common/utils/to-rate';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { TransactionService } from '../src/transactions/services/transaction.service';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('the merchants page', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let superadmin: E2eUser;
  let trader: E2eUser;
  let cascade: E2eUser;
  let first: string;
  let second: string;
  let bankDetailsId: string;
  let rubId: number;

  const list = async (query = '') =>
    (
      await e2e.http
        .get(`/admin/merchants${query}`)
        .set(bearer(admin))
        .expect(200)
    ).body;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    superadmin = await e2e.createUser(Role.Superadmin);
    trader = await e2e.createUser(Role.Trader);
    cascade = await e2e.createUser(Role.Cascade);

    const merchants = e2e.app.get(MerchantsService);
    first = (await merchants.create('Casino 1')).id;
    second = (await merchants.create('Casino 2')).id;

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
    rubId = currency.body.data.id;
    const bank = await e2e.http
      .post('/admin/banks')
      .set(bearer(admin))
      .send({
        bankId: 'tbank',
        name: 'Т-банк',
        countryId: country.body.data.id,
        currencyId: currency.body.data.id,
        transactionTypes: ['card', 'sbp'],
      })
      .expect(201);
    bankDetailsId = (
      await e2e.http
        .post('/bank-details')
        .set(bearer(trader))
        .send({ bankId: bank.body.data.id, type: 'sbp', phone: '+79012345678' })
        .expect(201)
    ).body.data.id;
  });

  afterAll(() => e2e.close());

  it('groups merchants, applies group flags, and deletes a group left empty', async () => {
    const created = await e2e.http
      .post('/admin/merchant-groups')
      .set(bearer(admin))
      .send({ name: 'Группа мерчантов', merchantIds: [first] })
      .expect(201);
    const groupId = created.body.data.id;

    await e2e.http
      .post('/admin/merchant-groups')
      .set(bearer(admin))
      .send({ name: 'ГРУППА МЕРЧАНТОВ', merchantIds: [second] })
      .expect(409);

    await e2e.http
      .post(`/admin/merchant-groups/${groupId}/merchants`)
      .set(bearer(admin))
      .send({ merchantIds: [second] })
      .expect(200);

    await e2e.http
      .patch(`/admin/merchant-groups/${groupId}`)
      .set(bearer(admin))
      .send({ exclusiveTopUp: true })
      .expect(200);

    const page = await list();
    expect(page.meta.total).toBe(1);
    expect(page.data[0].kind).toBe('group');
    expect(page.data[0].group.exclusiveTopUp).toBe(true);
    expect(
      page.data[0].group.merchants.map(
        (row: { exclusiveTopUp: boolean }) => row.exclusiveTopUp,
      ),
    ).toEqual([true, true]);

    await e2e.http
      .patch(`/admin/merchants/${first}`)
      .set(bearer(admin))
      .send({ active: false, internalName: 'casino-internal' })
      .expect(200);
    const searched = await list('?search=CASINO-INT');
    expect(searched.data[0].group.merchants).toHaveLength(1);
    expect(searched.data[0].group.active).toBe(true);

    await e2e.http
      .delete(`/admin/merchant-groups/${groupId}/merchants/${first}`)
      .set(bearer(admin))
      .expect(200);
    const emptied = await e2e.http
      .delete(`/admin/merchant-groups/${groupId}/merchants/${second}`)
      .set(bearer(admin))
      .expect(200);
    expect(emptied.body.data).toBeNull();

    const flat = await list('?sortOrder=asc&sortBy=name');
    expect(
      flat.data.map((row: { kind: string; merchant: { name: string } }) => [
        row.kind,
        row.merchant.name,
      ]),
    ).toEqual([
      ['merchant', 'Casino 1'],
      ['merchant', 'Casino 2'],
    ]);
    await e2e.http
      .get('/admin/merchant-groups')
      .set(bearer(admin))
      .expect(200)
      .expect(({ body }) => expect(body.meta.total).toBe(0));
  });

  it('sets a merchant rate and switches a method on, shown on the chips', async () => {
    await e2e.http
      .put(`/admin/merchants/${second}/rates`)
      .set(bearer(admin))
      .send({
        methods: [
          { method: 'sbp', general: { payInPercent: 10, payOutPercent: 3 } },
        ],
      })
      .expect(200);
    await e2e.http
      .put(`/admin/merchants/${second}/methods`)
      .set(bearer(admin))
      .send({
        methods: [{ method: 'sbp', payInEnabled: true, payOutEnabled: false }],
      })
      .expect(200);

    const row = (await list(`?search=${second}`)).data[0].merchant;
    expect(row.methods.payIn[0]).toEqual({
      method: 'sbp',
      enabled: true,
      percent: 10,
      volume: '0.00',
    });
    expect(row.methods.payOut[0]).toEqual({
      method: 'sbp',
      enabled: false,
      percent: 3,
      volume: '0.00',
    });
    expect(
      row.methods.payOut.map((chip: { method: string }) => chip.method),
    ).toEqual(['sbp', 'card']);
  });

  it('refuses a pay-out percent on a pay-in-only method with a 400', async () => {
    await e2e.http
      .put(`/admin/merchants/${second}/rates`)
      .set(bearer(admin))
      .send({
        methods: [
          {
            method: 'counterparty',
            general: { payInPercent: 10, payOutPercent: 1 },
          },
        ],
      })
      .expect(400);
    await e2e.http
      .put(`/admin/rates/base/trader`)
      .set(bearer(admin))
      .send({
        methods: [
          { method: 'mobile_commerce', payInPercent: 5, payOutPercent: 0 },
        ],
      })
      .expect(200);
  });

  it('attaches a trader and a cascade, flips one switch and detaches', async () => {
    await e2e.http
      .put(`/admin/merchants/${second}/attachments`)
      .set(bearer(admin))
      .send({
        traders: [{ userId: cascade.user.id, trading: true, methods: [] }],
        cascades: [],
      })
      .expect(400);

    const replaced = await e2e.http
      .put(`/admin/merchants/${second}/attachments`)
      .set(bearer(admin))
      .send({
        traders: [
          {
            userId: trader.user.id,
            trading: true,
            methods: [{ method: 'card', enabled: true }],
          },
        ],
        cascades: [{ userId: cascade.user.id, trading: true, methods: [] }],
      })
      .expect(200);
    expect(replaced.body.data.traders[0].login).toBe(trader.login);
    expect(replaced.body.data.cascades[0].userId).toBe(cascade.user.id);

    await e2e.http
      .patch(`/admin/merchants/${second}/attachments/${trader.user.id}`)
      .set(bearer(admin))
      .send({ methods: [{ method: 'sbp', enabled: true }] })
      .expect(200)
      .expect(({ body }) =>
        expect(
          body.data.methods.filter((m: { enabled: boolean }) => m.enabled),
        ).toEqual([
          { method: 'sbp', enabled: true },
          { method: 'card', enabled: true },
        ]),
      );

    expect(
      (await list(`?search=${second}`)).data[0].merchant.attachments,
    ).toEqual({ traders: 1, cascades: 1 });

    await e2e.http
      .delete(`/admin/merchants/${second}/attachments/${cascade.user.id}`)
      .set(bearer(admin))
      .expect(200)
      .expect(({ body }) => expect(body.data.cascades).toEqual([]));
  });

  it('credits a successful pay-in to the merchant balance and, with overdraft on, settles a pay-out below zero', async () => {
    await e2e.dataSource
      .getRepository(Wallet)
      .save({ userId: trader.user.id, mainBalance: toCrypto(1000) });
    const deals = e2e.app.get(TransactionService);
    const deal = (kind: TransactionKind.PayIn | TransactionKind.PayOut) =>
      deals.createDeal({
        kind,
        method: 'sbp',
        traderUserId: trader.user.id,
        bankDetailsId,
        merchantId: second,
        amountFiat: toFiat(9000),
        rate: toRate(90),
        merchantPercent: 10,
        traderPercent: 7,
      });
    const succeed = (id: string, path: string[]) =>
      path.reduce(
        (previous, status) =>
          previous.then(() =>
            e2e.http
              .patch(`/admin/transactions/${id}/status`)
              .set(bearer(admin))
              .send({ status })
              .expect(200)
              .then(() => undefined),
          ),
        Promise.resolve(),
      );

    const payIn = await deal(TransactionKind.PayIn);
    await succeed(payIn.id, ['success']);
    const afterPayIn = (await list(`?search=${second}`)).data[0].merchant
      .balance;
    expect(afterPayIn).toBe(payIn.merchantAmount.toFixed(6));

    await e2e.http
      .patch(`/admin/merchants/${second}/settings`)
      .set(bearer(superadmin))
      .send({ payoutOverdraftEnabled: true })
      .expect(200);
    const payOut = await deal(TransactionKind.PayOut);
    await succeed(payOut.id, ['active', 'success']);
    await succeed(payOut.id, ['success']);
    const afterPayOut = (await list(`?search=${second}`)).data[0].merchant
      .balance;
    expect(afterPayOut).toBe(
      payIn.merchantAmount.minus(payOut.merchantAmount).toFixed(6),
    );
    expect(Number(afterPayOut)).toBeLessThan(0);

    const sorted = await list('?sortBy=balance&sortOrder=desc');
    expect(sorted.data[0].merchant.id).toBe(first);

    const sbpVolume = async (query: string) => {
      const row = (await list(`?search=${second}${query}`)).data[0].merchant;

      return [row.methods.payIn[0].volume, row.methods.payOut[0].volume];
    };
    expect(await sbpVolume('')).toEqual(['9000.00', '9000.00']);
    expect(await sbpVolume('&period=last_7_days')).toEqual([
      '9000.00',
      '9000.00',
    ]);
    expect(await sbpVolume('&period=yesterday')).toEqual(['0.00', '0.00']);
    expect(
      await sbpVolume('&periodFrom=2020-01-01&periodTo=2020-01-31'),
    ).toEqual(['0.00', '0.00']);
    await e2e.http
      .get(
        '/admin/merchants?period=today&periodFrom=2020-01-01&periodTo=2020-01-02',
      )
      .set(bearer(admin))
      .expect(400);
    await e2e.http
      .get('/admin/merchants?periodFrom=2020-01-02&periodTo=2020-01-01')
      .set(bearer(admin))
      .expect(400);

    await expect(
      deals.createDeal({
        kind: TransactionKind.PayOut,
        method: 'counterparty',
        traderUserId: trader.user.id,
        bankDetailsId,
        merchantId: second,
        amountFiat: toFiat(9000),
        rate: toRate(90),
        merchantPercent: 10,
        traderPercent: 7,
      }),
    ).rejects.toThrow(/does not work for pay_out/);
  });

  it('holds a pay-out in escrow, returns it on a cancel, settles it on success and refuses one the balance does not cover', async () => {
    const third = (await e2e.app.get(MerchantsService).create('Casino 3')).id;
    const deals = e2e.app.get(TransactionService);
    const payOut = () =>
      deals.createDeal({
        kind: TransactionKind.PayOut,
        method: 'sbp',
        traderUserId: trader.user.id,
        bankDetailsId,
        merchantId: third,
        amountFiat: toFiat(9000),
        rate: toRate(90),
        merchantPercent: 10,
        traderPercent: 7,
      });
    const status = (id: string, value: string) =>
      e2e.http
        .patch(`/admin/transactions/${id}/status`)
        .set(bearer(admin))
        .send({ status: value })
        .expect(200);
    const card = async () =>
      (
        await e2e.http
          .get(`/admin/merchants/${third}`)
          .set(bearer(admin))
          .expect(200)
      ).body.data;

    await e2e.http
      .post(`/admin/merchants/${third}/balance/adjustments`)
      .set(bearer(admin))
      .send({ direction: 'credit', amount: '200', comment: 'top up' })
      .expect(403);
    await e2e.http
      .post(`/admin/merchants/${third}/balance/adjustments`)
      .set(bearer(superadmin))
      .send({ direction: 'credit', amount: '200', comment: 'top up' })
      .expect(201);

    const canceled = await payOut();
    const held = canceled.merchantAmount;
    expect(await card()).toEqual(
      expect.objectContaining({
        balance: toCrypto(200).minus(held).toFixed(6),
        escrow: held.toFixed(6),
      }),
    );

    await status(canceled.id, 'canceled');
    expect(await card()).toEqual(
      expect.objectContaining({ balance: '200.000000', escrow: '0.000000' }),
    );

    const settled = await payOut();
    await status(settled.id, 'active');
    await status(settled.id, 'success');
    expect(await card()).toEqual(
      expect.objectContaining({
        balance: toCrypto(200).minus(held).toFixed(6),
        escrow: '0.000000',
      }),
    );

    await expect(payOut()).rejects.toThrow(/does not cover the pay-out/);

    const journal = (
      await e2e.http
        .get(`/admin/merchants/${third}/balance-operations`)
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(journal.data.map((row: { type: string }) => row.type)).toEqual([
      'deal_pay_out',
      'deal_pay_out_escrow',
      'deal_pay_out_escrow_release',
      'deal_pay_out_escrow',
      'admin_adjustment',
    ]);
    const adjustments = (
      await e2e.http
        .get(
          `/admin/merchants/${third}/balance-operations?type=admin_adjustment`,
        )
        .set(bearer(admin))
        .expect(200)
    ).body;
    expect(adjustments.data).toEqual([
      expect.objectContaining({
        amount: '200.000000',
        comment: 'top up',
        actorUserId: superadmin.user.id,
        transactionId: null,
      }),
    ]);
    await e2e.http
      .get(`/admin/merchants/${third}/balance-operations/export`)
      .set(bearer(admin))
      .expect(200)
      .expect('Content-Type', /text\/csv/)
      .expect(({ text }) => expect(text.split('\r\n')).toHaveLength(7));
  });

  it('settles a held pay-out once through a dispute ending in success_changed, returns one ending canceled, and the journal adds up', async () => {
    const fourth = (await e2e.app.get(MerchantsService).create('Casino 4')).id;
    const deals = e2e.app.get(TransactionService);
    const payOut = () =>
      deals.createDeal({
        kind: TransactionKind.PayOut,
        method: 'sbp',
        traderUserId: trader.user.id,
        bankDetailsId,
        merchantId: fourth,
        amountFiat: toFiat(4500),
        rate: toRate(90),
        merchantPercent: 10,
        traderPercent: 7,
      });
    const walk = async (id: string, statuses: string[]) => {
      for (const value of statuses) {
        await e2e.http
          .patch(`/admin/transactions/${id}/status`)
          .set(bearer(admin))
          .send({ status: value })
          .expect(200);
      }
    };
    const card = async () =>
      (
        await e2e.http
          .get(`/admin/merchants/${fourth}`)
          .set(bearer(admin))
          .expect(200)
      ).body.data;

    await e2e.http
      .post(`/admin/merchants/${fourth}/balance/adjustments`)
      .set(bearer(superadmin))
      .send({ direction: 'credit', amount: '500', comment: 'top up' })
      .expect(201);

    const changed = await payOut();
    const returned = await payOut();
    const held = changed.merchantAmount;

    await walk(changed.id, [
      'active',
      'dispute',
      'manual_review',
      'success_changed',
    ]);
    await walk(returned.id, ['active', 'dispute', 'manual_review', 'canceled']);
    await e2e.http
      .patch(`/admin/transactions/${changed.id}/status`)
      .set(bearer(admin))
      .send({ status: 'success' })
      .expect(409);

    expect(await card()).toEqual(
      expect.objectContaining({
        balance: toCrypto(500).minus(held).toFixed(6),
        escrow: '0.000000',
      }),
    );

    const rows = (
      await e2e.http
        .get(`/admin/merchants/${fourth}/balance-operations?sortOrder=asc`)
        .set(bearer(admin))
        .expect(200)
    ).body.data as {
      type: string;
      amount: string;
      balanceBefore: string;
      balanceAfter: string;
      escrowBefore: string;
      escrowAfter: string;
    }[];

    expect(rows.map((row) => row.type)).toEqual([
      'admin_adjustment',
      'deal_pay_out_escrow',
      'deal_pay_out_escrow',
      'deal_pay_out',
      'deal_pay_out_escrow_release',
    ]);
    for (const [index, row] of rows.entries()) {
      expect(row.amount).toBe(
        toCrypto(row.balanceAfter).minus(row.balanceBefore).toFixed(6),
      );
      if (index > 0) {
        expect(row.balanceBefore).toBe(rows[index - 1].balanceAfter);
        expect(row.escrowBefore).toBe(rows[index - 1].escrowAfter);
      }
    }
    expect(rows[rows.length - 1].escrowAfter).toBe('0.000000');
  });

  it('keeps a whitelisted address out of the audit an admin can read', async () => {
    await e2e.http
      .post(`/admin/merchants/${second}/ip-addresses`)
      .set(bearer(admin))
      .send({ ip: '192.0.2.77' })
      .expect(201);

    const audit = async (action: string) =>
      (
        await e2e.http
          .get('/admin/audit')
          .query({ action })
          .set(bearer(admin))
          .expect(200)
      ).body.data as { metadata: unknown; body: unknown }[];
    const eventually = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const rows = await read();

        if (rows.length) return rows;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      return read();
    };

    const domain = await audit('merchant.ip_added');
    const http = await eventually(() =>
      audit('POST /admin/merchants/:id/ip-addresses'),
    );

    expect(JSON.stringify(domain)).not.toContain('192.0.2.77');
    expect(domain[0].metadata).toEqual(
      expect.objectContaining({ ip: '192.0.*.*' }),
    );
    expect(JSON.stringify(http)).not.toContain('192.0.2.77');
    expect(http[0].body).toEqual({ ip: '[REDACTED]' });
  });

  it('answers a custom period ending on 9999-12-31 without failing, and refuses a zone-less date-time', async () => {
    await list('?periodFrom=2026-01-01&periodTo=9999-12-31');
    await e2e.http
      .get(`/admin/merchants/${first}/balance-operations?from=2026-10-26T10:00`)
      .set(bearer(admin))
      .expect(400);
    await e2e.http
      .get(`/admin/merchants/${first}/balance-operations?from=2026-10`)
      .set(bearer(admin))
      .expect(400);
  });

  it('edits the merchant page: currencies, markups, settings, IP whitelist, keys and accounts', async () => {
    await e2e.http
      .patch(`/admin/merchants/${first}`)
      .set(bearer(admin))
      .send({ currencyIds: [rubId], defaultCurrencyId: rubId + 1000 })
      .expect(400);
    await e2e.http
      .patch(`/admin/merchants/${first}`)
      .set(bearer(admin))
      .send({ currencyIds: [rubId], defaultCurrencyId: rubId })
      .expect(200);
    await e2e.http
      .put(`/admin/merchants/${first}/markups`)
      .set(bearer(admin))
      .send({
        markups: [{ currencyId: rubId, payInPercent: 1.5, payOutPercent: 0 }],
      })
      .expect(200);
    await e2e.http
      .put(`/admin/merchants/${first}/markups`)
      .set(bearer(admin))
      .send({
        markups: [
          { currencyId: rubId + 1000, payInPercent: 1, payOutPercent: 0 },
        ],
      })
      .expect(400);

    await e2e.http
      .patch(`/admin/merchants/${first}/settings`)
      .set(bearer(admin))
      .send({ payoutOverdraftEnabled: true })
      .expect(403);
    await e2e.http
      .patch(`/admin/merchants/${first}/settings`)
      .set(bearer(admin))
      .send({
        minPayInAmount: '50000',
        randomizationWindow: 20,
        callbackUrl: 'https://play2x.games/api/ipn/oh',
      })
      .expect(200);
    await e2e.http
      .patch(`/admin/merchants/${first}/settings`)
      .set(bearer(superadmin))
      .send({ ipCheckEnabled: true })
      .expect(400);

    const added = await e2e.http
      .post(`/admin/merchants/${first}/ip-addresses`)
      .set(bearer(admin))
      .send({ ip: '203.0.113.47' })
      .expect(201);
    expect(added.body.data.ip).toBe('203.0.*.*');
    await e2e.http
      .post(`/admin/merchants/${first}/ip-addresses`)
      .set(bearer(admin))
      .send({ ip: '203.0.113.47' })
      .expect(409);
    await e2e.http
      .patch(`/admin/merchants/${first}/settings`)
      .set(bearer(superadmin))
      .send({ ipCheckEnabled: true })
      .expect(200);
    const full = await e2e.http
      .get(`/admin/merchants/${first}/ip-addresses`)
      .set(bearer(superadmin))
      .expect(200);
    expect(full.body.data[0].ip).toBe('203.0.113.47');
    await e2e.http
      .delete(`/admin/merchants/${first}/ip-addresses/${added.body.data.id}`)
      .set(bearer(admin))
      .expect(403);
    await e2e.http
      .delete(`/admin/merchants/${first}/ip-addresses/${added.body.data.id}`)
      .set(bearer(superadmin))
      .expect(400);

    await e2e.http
      .get(`/admin/merchants/${first}/keys`)
      .set(bearer(admin))
      .expect(403);
    const issued = await e2e.http
      .post(`/admin/merchants/${first}/keys`)
      .set(bearer(superadmin))
      .expect(201);
    expect(issued.body.data.secret).toMatch(/^[0-9a-f]{64}$/);
    await e2e.http
      .post(`/admin/merchants/${first}/keys/${issued.body.data.id}/revoke`)
      .set(bearer(superadmin))
      .expect(200)
      .expect(({ body }) => expect(body.data.active).toBe(false));
    const keys = await e2e.http
      .get(`/admin/merchants/${first}/keys`)
      .set(bearer(superadmin))
      .expect(200);
    expect(keys.body.data).toEqual([
      expect.not.objectContaining({ secret: expect.anything() }),
    ]);

    const card = (
      await e2e.http
        .get(`/admin/merchants/${first}`)
        .set(bearer(admin))
        .expect(200)
    ).body.data;
    expect(card.currencies).toEqual([
      expect.objectContaining({
        currencyId: rubId,
        isocode: 'RUB',
        payInMarkupPercent: 1.5,
        payOutMarkupPercent: 0,
      }),
    ]);
    expect(card.settings).toEqual(
      expect.objectContaining({
        defaultCurrencyId: rubId,
        minPayInAmount: '50000.00',
        randomizationWindow: 20,
        ipCheckEnabled: true,
        callbackUrl: 'https://play2x.games/api/ipn/oh',
      }),
    );
    expect(card.kpi.conversion).toEqual({
      successful: 0,
      total: 0,
      percent: 0,
    });
    expect(card.kpi.turnover).toEqual({ amount: '0.000000', count: 0 });

    const account = await e2e.createUser(Role.Merchant, { merchantId: first });
    const accounts = await e2e.http
      .get(`/admin/users?merchantId=${first}`)
      .set(bearer(admin))
      .expect(200);
    expect(accounts.body.data.map((row: { id: string }) => row.id)).toEqual([
      account.user.id,
    ]);
  });

  it('refuses every merchants route to a trader and to nobody', async () => {
    const routes: [string, string][] = [
      ['get', '/admin/merchants'],
      ['patch', `/admin/merchants/${first}`],
      ['put', `/admin/merchants/${first}/methods`],
      ['get', `/admin/merchants/${first}/rates`],
      ['put', `/admin/merchants/${first}/rates`],
      ['get', `/admin/merchants/${first}/attachments`],
      ['put', `/admin/merchants/${first}/attachments`],
      ['get', '/admin/merchant-groups'],
      ['post', '/admin/merchant-groups'],
      ['patch', '/admin/merchant-groups/1'],
      ['post', '/admin/merchant-groups/1/merchants'],
      ['delete', `/admin/merchant-groups/1/merchants/${first}`],
      ['get', `/admin/merchants/${first}`],
      ['put', `/admin/merchants/${first}/markups`],
      ['patch', `/admin/merchants/${first}/settings`],
      ['get', `/admin/merchants/${first}/keys`],
      ['post', `/admin/merchants/${first}/keys`],
      ['get', `/admin/merchants/${first}/ip-addresses`],
      ['post', `/admin/merchants/${first}/ip-addresses`],
      ['delete', `/admin/merchants/${first}/ip-addresses/1`],
      ['get', `/admin/merchants/${first}/balance-operations`],
      ['get', `/admin/merchants/${first}/balance-operations/export`],
      ['post', `/admin/merchants/${first}/balance/adjustments`],
    ];

    for (const [method, path] of routes) {
      const call = (
        e2e.http as unknown as Record<
          string,
          (url: string) => import('supertest').Test
        >
      )[method](path);
      await call.expect(401);
      const asTrader = (
        e2e.http as unknown as Record<
          string,
          (url: string) => import('supertest').Test
        >
      )[method](path);
      await asTrader.set(bearer(trader)).send({}).expect(403);
    }

    await e2e.http
      .post('/admin/merchants')
      .set(bearer(admin))
      .send({ name: 'x' })
      .expect(404);
  });
});
