import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { BankDetails } from '../src/bank-details/entities/bank-details.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { DeviceMessage } from '../src/device-messages/entities/device-message.entity';
import { DeviceMessageRetentionService } from '../src/device-messages/services/device-message-retention.service';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantCallback } from '../src/merchant-callbacks/entities/merchant-callback.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { User } from '../src/users/entities/user.entity';
import { UserStatus } from '../src/users/types/user-status.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const CREDIT_PATTERN = 'Пополнение на (?<amount>[\\d ]+(?:[.,]\\d{1,2})?) ₽';

describe('device messages and automatic confirmation', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let stranger: E2eUser;
  let merchantId: string;
  let key: string;
  let tbankId: number;
  let sberId: number;
  let deviceId: number;
  let deviceToken: string;
  let strangerToken: string;
  let externalSeq = 0;

  const deviceBearer = (token: string) => ({
    Authorization: `Bearer ${token}`,
  });

  const createPayIn = async (amount: string): Promise<string> =>
    (
      await e2e.http
        .post('/v1/payment/pay-in')
        .set('X-Secure-Key', key)
        .send({
          method: 'sbp',
          amount,
          merchantTransactionId: `order-${Math.random().toString(36).slice(2)}`,
          payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
          callbackUrl: 'https://merchant.example/hook',
        })
        .expect(201)
    ).body.data.id as string;

  const dealRow = (id: string) =>
    e2e.dataSource.getRepository(Transaction).findOneOrFail({ where: { id } });
  const wallet = (user: E2eUser) =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneOrFail({ where: { userId: user.user.id } });
  const merchantBalance = () =>
    e2e.dataSource
      .getRepository(MerchantBalance)
      .findOne({ where: { merchantId } });

  const send = (
    token: string,
    body: Partial<{
      externalId: string;
      kind: string;
      sender: string;
      text: string;
      receivedAt: string;
    }>,
  ) => {
    externalSeq += 1;

    return e2e.http
      .post('/device/messages')
      .set(deviceBearer(token))
      .send({
        externalId: `msg-${externalSeq}`,
        kind: 'sms',
        sender: 'T-Bank',
        text: 'Пополнение на 1 000 ₽',
        receivedAt: new Date().toISOString(),
        ...body,
      });
  };

  const credit = (amountFiat: { toFixed: (n: number) => string }) =>
    `Пополнение на ${amountFiat.toFixed(2).replace('.', ',')} ₽. Баланс 5 ₽`;

  const pairedDevice = async (owner: E2eUser, name: string) => {
    const id = (
      await e2e.http
        .post('/trader/devices')
        .set(bearer(owner))
        .send({ name })
        .expect(201)
    ).body.data.id as number;
    const issued = await e2e.http
      .post(`/trader/devices/${id}/pairing`)
      .set(bearer(owner))
      .expect(201);
    const token = (
      await e2e.http
        .post('/device/pair')
        .send({
          pairingToken: JSON.parse(issued.body.data.qrPayload).pairingToken,
        })
        .expect(200)
    ).body.data.deviceToken as string;

    await e2e.dataSource
      .getRepository(Device)
      .update(id, { lastActivity: new Date(Date.now() + 3_600_000) });

    return { id, token };
  };

  const requisiteOn = async (
    owner: E2eUser,
    device: number,
    bankId: number,
    phone: string,
  ) =>
    e2e.http
      .post('/trader/requisites')
      .set(bearer(owner))
      .send({
        type: 'card_or_sbp',
        bankId,
        deviceId: device,
        phone,
        cardholderName: 'IVAN IVANOV',
        dailyAmountLimit: '1000000.00',
      })
      .expect(201);

  const bankOf = async (code: string, countryId: number, currencyId: number) =>
    (
      await e2e.http
        .post('/admin/banks')
        .set(bearer(admin))
        .send({
          bankId: code,
          code,
          name: code,
          countryId,
          currencyId,
          transactionTypes: ['card', 'sbp'],
        })
        .expect(201)
    ).body.data.id as number;

  const traderWithMoney = async () => {
    const user = await e2e.createUser(Role.Trader);

    await e2e.dataSource
      .getRepository(TraderSettings)
      .save({ userId: user.user.id, tradingEnabled: true });
    await e2e.dataSource.getRepository(Wallet).save({
      userId: user.user.id,
      mainBalance: toCrypto(100000),
      insurancePayInBalance: toCrypto(1000),
    });

    return user;
  };

  beforeAll(async () => {
    e2e = await startE2e();
    const superadmin = await e2e.createUser(Role.Superadmin);
    admin = await e2e.createUser(Role.Admin);
    const merchants = e2e.app.get(MerchantsService);

    merchantId = (await merchants.create('Casino')).id;
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

    tbankId = await bankOf(
      'tbank',
      country.body.data.id,
      currency.body.data.id,
    );
    sberId = await bankOf('sber', country.body.data.id, currency.body.data.id);

    await e2e.dataSource.getRepository(MethodRate).save([
      {
        scope: RateScope.Trader,
        method: 'sbp',
        payInPercent: 7,
        payOutPercent: 0,
      },
      {
        scope: RateScope.Merchant,
        method: 'sbp',
        payInPercent: 10,
        payOutPercent: 0,
      },
    ]);
    await e2e.dataSource.getRepository(MerchantMethod).save({
      merchantId,
      method: 'sbp',
      payInEnabled: true,
      payOutEnabled: false,
    });

    trader = await traderWithMoney();
    stranger = await traderWithMoney();

    ({ id: deviceId, token: deviceToken } = await pairedDevice(
      trader,
      'Pixel 7',
    ));
    await requisiteOn(trader, deviceId, tbankId, '+79010000001');
    await requisiteOn(trader, deviceId, tbankId, '+79010000002');

    const strangerDevice = await pairedDevice(stranger, 'Galaxy');
    strangerToken = strangerDevice.token;
    await requisiteOn(stranger, strangerDevice.id, tbankId, '+79010000009');
    await e2e.dataSource
      .getRepository(TraderSettings)
      .update({ userId: stranger.user.id }, { tradingEnabled: false });

    for (const template of [
      {
        bankId: tbankId,
        sender: 'T-Bank',
        messageType: 'credit',
        pattern: CREDIT_PATTERN,
      },
      {
        bankId: tbankId,
        sender: 'T-Bank',
        messageType: 'statement',
        pattern: 'Выписка за день: (?<amount>\\d+) ₽',
      },
      {
        bankId: sberId,
        sender: '900',
        messageType: 'credit',
        pattern: CREDIT_PATTERN,
      },
    ]) {
      await e2e.http
        .post('/admin/message-templates')
        .set(bearer(admin))
        .send(template)
        .expect(201);
    }
  });

  afterAll(() => e2e?.close());

  describe('templates', () => {
    it('lets an admin test a pattern, and refuses broken or slow ones', async () => {
      const tested = await e2e.http
        .post('/admin/message-templates/test')
        .set(bearer(admin))
        .send({ pattern: CREDIT_PATTERN, text: 'Пополнение на 1 500,5 ₽' })
        .expect(200);
      expect(tested.body.data).toEqual({ matched: true, amount: '1500.50' });

      await e2e.http
        .post('/admin/message-templates')
        .set(bearer(admin))
        .send({
          bankId: tbankId,
          sender: 'T-Bank',
          messageType: 'credit',
          pattern: 'Пополнение на (\\d+)',
        })
        .expect(400);
      await e2e.http
        .post('/admin/message-templates')
        .set(bearer(admin))
        .send({
          bankId: 999999,
          sender: 'T-Bank',
          messageType: 'credit',
          pattern: CREDIT_PATTERN,
        })
        .expect(400);

      const started = Date.now();
      await e2e.http
        .post('/admin/message-templates/test')
        .set(bearer(admin))
        .send({ pattern: '^(?<amount>a+)+$', text: `${'a'.repeat(40)}!` })
        .expect(400);
      expect(Date.now() - started).toBeLessThan(2000);

      await e2e.http
        .get('/admin/message-templates')
        .set(bearer(trader))
        .expect(403);

      const listed = await e2e.http
        .get('/admin/message-templates')
        .set(bearer(admin))
        .query({ bankId: tbankId })
        .expect(200);
      expect(listed.body.meta.total).toBe(2);
    });
  });

  it('answers 401 without a device token', async () => {
    await e2e.http
      .post('/device/messages')
      .send({
        externalId: 'x',
        kind: 'sms',
        sender: 'T-Bank',
        text: 'Пополнение на 1 ₽',
        receivedAt: new Date().toISOString(),
      })
      .expect(401);
    await send('not-a-token', {}).expect(401);
  });

  it('a credit SMS confirms the one matching pay-in: balances, the event, the callback and the audit; a repeat moves nothing', async () => {
    const id = await createPayIn('1500');
    const created = await dealRow(id);
    const before = await wallet(trader);
    const balanceBefore = await merchantBalance();

    const answer = await send(deviceToken, {
      externalId: 'sms-confirm',
      text: credit(created.amountFiat),
    }).expect(200);

    expect(answer.body.data).toEqual({
      id: expect.any(Number),
      messageType: 'credit',
      matchStatus: 'matched',
      transactionId: id,
    });
    expect((await dealRow(id)).status).toBe('success');

    const after = await wallet(trader);
    expect(after.mainBalance.toFixed(6)).toBe(
      before.mainBalance.minus(created.traderAmount).toFixed(6),
    );
    expect(after.mainReserved.toFixed(6)).toBe(
      before.mainReserved.minus(created.traderAmount).toFixed(6),
    );
    expect((await merchantBalance())?.balance.toFixed(6)).toBe(
      (balanceBefore?.balance ?? toCrypto(0))
        .plus(created.merchantAmount)
        .toFixed(6),
    );

    const event = await e2e.dataSource
      .getRepository(TransactionStatusEvent)
      .findOneOrFail({
        where: { transactionId: id, toStatus: 'success' as never },
      });
    expect(event.source).toBe('device');
    expect(event.actorUserId).toBe(trader.user.id);

    const callbacks = await e2e.dataSource
      .getRepository(MerchantCallback)
      .find({ where: { transactionId: id } });
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toEqual(
      expect.objectContaining({
        event: 'status_changed',
        url: 'https://merchant.example/hook',
      }),
    );
    expect(callbacks[0].payload.payment).toEqual(
      expect.objectContaining({ id, status: 'success' }),
    );

    const audit = await e2e.dataSource
      .getRepository(AuditLog)
      .find({ where: { action: 'device.deal_confirmed' } });
    expect(audit.filter((row) => row.metadata?.transactionId === id)).toEqual([
      expect.objectContaining({
        actorUserId: trader.user.id,
        metadata: expect.objectContaining({
          deviceId,
          messageId: answer.body.data.id,
          amountFiat: created.amountFiat.toFixed(2),
        }),
      }),
    ]);

    const repeat = await send(deviceToken, {
      externalId: 'sms-confirm',
      text: credit(created.amountFiat),
    }).expect(200);
    expect(repeat.body.data).toEqual(answer.body.data);
    expect((await wallet(trader)).mainBalance.toFixed(6)).toBe(
      after.mainBalance.toFixed(6),
    );
    expect(
      await e2e.dataSource
        .getRepository(DeviceMessage)
        .count({ where: { externalId: 'sms-confirm' } }),
    ).toBe(1);
  });

  it('never confirms another trader’s deal: the stranger’s phone finds no candidate', async () => {
    const id = await createPayIn('1700');
    const created = await dealRow(id);

    const answer = await send(strangerToken, {
      text: credit(created.amountFiat),
    }).expect(200);

    expect(answer.body.data).toEqual(
      expect.objectContaining({
        matchStatus: 'no_candidate',
        transactionId: null,
      }),
    );
    expect((await dealRow(id)).status).toBe('active');
  });

  it('two deals of one amount on the device: nothing is confirmed', async () => {
    const first = await createPayIn('2500');
    const second = await createPayIn('2500');
    expect((await dealRow(first)).bankDetailsId).not.toBe(
      (await dealRow(second)).bankDetailsId,
    );

    const answer = await send(deviceToken, {
      text: credit((await dealRow(first)).amountFiat),
    }).expect(200);

    expect(answer.body.data.matchStatus).toBe('ambiguous');
    expect((await dealRow(first)).status).toBe('active');
    expect((await dealRow(second)).status).toBe('active');
  });

  it('a credit read by another bank’s template does not confirm the deal on this bank’s requisite', async () => {
    const id = await createPayIn('3100');

    const answer = await send(deviceToken, {
      sender: '900',
      text: credit((await dealRow(id)).amountFiat),
    }).expect(200);

    expect(answer.body.data.matchStatus).toBe('bank_mismatch');
    expect((await dealRow(id)).status).toBe('active');
  });

  it('a suspended owner’s phone confirms nothing', async () => {
    const id = await createPayIn('3300');
    const users = e2e.dataSource.getRepository(User);

    await users.update(trader.user.id, { status: UserStatus.Suspended });
    try {
      const answer = await send(deviceToken, {
        text: credit((await dealRow(id)).amountFiat),
      }).expect(200);

      expect(answer.body.data.matchStatus).toBe('account_inactive');
      expect((await dealRow(id)).status).toBe('active');
    } finally {
      await users.update(trader.user.id, { status: UserStatus.Active });
    }
  });

  it('stores what it cannot use: an unknown sender, an unread text, a statement', async () => {
    const unknown = await send(deviceToken, {
      kind: 'push',
      sender: 'Spam',
      text: 'Скидки 50%',
    }).expect(200);
    expect(unknown.body.data).toEqual(
      expect.objectContaining({
        messageType: 'unknown',
        matchStatus: 'no_template',
      }),
    );

    const unread = await send(deviceToken, { text: 'Код входа 1234' }).expect(
      200,
    );
    expect(unread.body.data.matchStatus).toBe('no_template');

    const statement = await send(deviceToken, {
      text: 'Выписка за день: 9000 ₽',
    }).expect(200);
    expect(statement.body.data).toEqual(
      expect.objectContaining({
        messageType: 'statement',
        matchStatus: 'ignored',
      }),
    );

    await send(deviceToken, { text: 'x'.repeat(2001) }).expect(400);
    await send(deviceToken, { receivedAt: '2026-11-08T10:00' }).expect(400);
  });

  describe('the trader’s «Сообщения»', () => {
    it('lists the own messages, hides unknown senders unless asked, and counts the tabs', async () => {
      const listed = await e2e.http
        .get('/trader/messages')
        .set(bearer(trader))
        .expect(200);
      const rows = listed.body.data as {
        sender: string;
        matchStatus: string;
        transactionId: string | null;
        amount: string | null;
      }[];

      expect(rows.some((row) => row.sender === 'Spam')).toBe(false);
      expect(rows.find((row) => row.matchStatus === 'matched')).toEqual(
        expect.objectContaining({
          amount: '1500.00',
          transactionId: expect.any(String),
        }),
      );

      const all = await e2e.http
        .get('/trader/messages')
        .set(bearer(trader))
        .query({ unknownSenders: 'show' })
        .expect(200);
      expect(all.body.meta.total).toBe(listed.body.meta.total + 1);

      const counters = await e2e.http
        .get('/trader/messages/counters')
        .set(bearer(trader))
        .query({ unknownSenders: 'show' })
        .expect(200);
      expect(counters.body.data).toEqual({
        all: all.body.meta.total,
        push: 1,
        sms: all.body.meta.total - 1,
        credit: 4,
        statement: 1,
      });

      const searched = await e2e.http
        .get('/trader/messages')
        .set(bearer(trader))
        .query({ search: 'Выписка' })
        .expect(200);
      expect(searched.body.meta.total).toBe(1);

      const strangers = await e2e.http
        .get('/trader/messages')
        .set(bearer(stranger))
        .expect(200);
      expect(strangers.body.meta.total).toBe(1);
    });

    it('shows a device’s messages on its page and hides another trader’s device', async () => {
      const own = await e2e.http
        .get(`/trader/devices/${deviceId}/messages`)
        .set(bearer(trader))
        .expect(200);
      expect(own.body.meta.total).toBeGreaterThan(0);

      await e2e.http
        .get(`/trader/devices/${deviceId}/messages`)
        .set(bearer(stranger))
        .expect(404);
    });
  });

  describe('owner decisions of 2026-11-08', () => {
    const minutes = (n: number) => n * 60 * 1000;
    const shiftCreatedAt = (id: string, ms: number) =>
      e2e.dataSource
        .getRepository(Transaction)
        .update(id, { createdAt: new Date(Date.now() - ms) });

    it('confirms a deal in checking_manually, the payer’s timer having run out', async () => {
      const id = await createPayIn('3500');
      await e2e.dataSource
        .getRepository(Transaction)
        .update(id, { status: 'checking_manually' as never });

      const answer = await send(deviceToken, {
        text: credit((await dealRow(id)).amountFiat),
      }).expect(200);

      expect(answer.body.data).toEqual(
        expect.objectContaining({ matchStatus: 'matched', transactionId: id }),
      );
      expect((await dealRow(id)).status).toBe('success');
    });

    it('confirms only a deal created no later than receivedAt plus the 2-minute tolerance', async () => {
      const id = await createPayIn('3700');
      const text = credit((await dealRow(id)).amountFiat);

      const early = await send(deviceToken, {
        text,
        receivedAt: new Date(Date.now() - minutes(10)).toISOString(),
      }).expect(200);
      expect(early.body.data.matchStatus).toBe('no_candidate');
      expect((await dealRow(id)).status).toBe('active');

      const withinTolerance = await send(deviceToken, {
        text,
        receivedAt: new Date(Date.now() - minutes(1)).toISOString(),
      }).expect(200);
      expect(withinTolerance.body.data).toEqual(
        expect.objectContaining({ matchStatus: 'matched', transactionId: id }),
      );
    });

    it('a deal created after the window does not make the message ambiguous', async () => {
      const older = await createPayIn('3900');
      const newer = await createPayIn('3900');
      await shiftCreatedAt(older, minutes(60));

      const answer = await send(deviceToken, {
        text: credit((await dealRow(older)).amountFiat),
        receivedAt: new Date(Date.now() - minutes(30)).toISOString(),
      }).expect(200);

      expect(answer.body.data).toEqual(
        expect.objectContaining({
          matchStatus: 'matched',
          transactionId: older,
        }),
      );
      expect((await dealRow(newer)).status).toBe('active');
    });

    it('confirms a deal on a requisite deleted since, as on a disabled one (Q-TC10.10)', async () => {
      const id = await createPayIn('4100');
      const deal = await dealRow(id);

      await e2e.http
        .delete(`/trader/requisites/${deal.bankDetailsId}`)
        .set(bearer(trader))
        .expect(200);
      expect(
        await e2e.dataSource
          .getRepository(BankDetails)
          .findOne({ where: { id: deal.bankDetailsId } }),
      ).toBeNull();

      const answer = await send(deviceToken, {
        text: credit(deal.amountFiat),
      }).expect(200);

      expect(answer.body.data).toEqual(
        expect.objectContaining({ matchStatus: 'matched', transactionId: id }),
      );
      expect((await dealRow(id)).status).toBe('success');
    });

    it('keeps the SMS text and the sender out of the http audit trail', async () => {
      await send(deviceToken, {
        sender: 'Spam',
        text: 'секретный текст',
      }).expect(200);
      await e2e.http
        .post('/admin/message-templates/test')
        .set(bearer(admin))
        .send({ pattern: CREDIT_PATTERN, text: 'образец секретный' })
        .expect(200);

      const trail = async () =>
        e2e.dataSource.getRepository(AuditLog).find({
          where: [
            { action: 'POST /device/messages' },
            { action: 'POST /admin/message-templates/test' },
          ],
        });
      let rows = await trail();
      for (let attempt = 0; attempt < 20 && rows.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        rows = await trail();
      }

      expect(rows.length).toBeGreaterThan(1);
      expect(JSON.stringify(rows.map((row) => row.body))).not.toContain(
        'секретный',
      );
      expect(JSON.stringify(rows.map((row) => row.body))).not.toContain('Spam');
    });
  });

  it('retention deletes the messages older than DEVICE_MESSAGE_RETENTION_DAYS', async () => {
    const repository = e2e.dataSource.getRepository(DeviceMessage);
    const total = await repository.count();

    await expect(
      e2e.app.get(DeviceMessageRetentionService).run(new Date()),
    ).resolves.toBe(0);
    await expect(
      e2e.app
        .get(DeviceMessageRetentionService)
        .run(new Date(Date.now() + 91 * 24 * 60 * 60 * 1000)),
    ).resolves.toBe(total);
    expect(await repository.count()).toBe(0);
  });
});
