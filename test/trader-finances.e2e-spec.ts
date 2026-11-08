import { TronWeb } from 'tronweb';
import { DataSource } from 'typeorm';
import { AccountTransaction } from '../src/account-transactions/entities/account-transaction.entity';
import { AccountTransactionStatus } from '../src/account-transactions/types/account-transaction-status.enum';
import { AccountTransactionType } from '../src/account-transactions/types/account-transaction-type.enum';
import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { WalletService } from '../src/transactions/services/wallet.service';
import { BalanceKind } from '../src/transactions/types/balance-kind.enum';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { User } from '../src/users/entities/user.entity';
import { UserStatus } from '../src/users/types/user-status.enum';
import { toFiat } from '../src/common/utils/to-fiat';
import { toRate } from '../src/common/utils/to-rate';
import { TransactionDispute } from '../src/transactions/entities/transaction-dispute.entity';
import { TransactionService } from '../src/transactions/services/transaction.service';
import { DisputeStatus } from '../src/transactions/types/dispute-status.enum';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../src/transactions/types/transaction-status.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, scan, usdtSun } from './support/flow';
import { EXTERNAL_SENDER } from './support/keys';

const DESTINATION = TronWeb.address.fromPrivateKey(
  '0'.repeat(63) + '3',
) as string;
const DAY_MS = 24 * 60 * 60 * 1000;

describe('the trader cabinet: the switch, the summary and the balances', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let merchantId: string;
  let key: string;
  let bankId: number;

  const deposit = async (user: E2eUser, amount: string): Promise<void> => {
    const address = (
      await e2e.http
        .get('/trader/deposit-address')
        .set(bearer(user))
        .expect(200)
    ).body.data.address as string;
    e2e.node.externalUsdtTransfer(EXTERNAL_SENDER, address, usdtSun(amount));
    await scan(e2e);
  };
  const walletOf = (user: E2eUser) =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneOrFail({ where: { userId: user.user.id } });
  const balances = async (user: E2eUser) =>
    (await e2e.http.get('/trader/balances').set(bearer(user)).expect(200)).body
      .data;
  const summary = async (user: E2eUser) =>
    (await e2e.http.get('/trader/summary').set(bearer(user)).expect(200)).body
      .data;
  const switchTrading = (user: E2eUser, enabled: boolean) =>
    e2e.http.post('/trader/trading').set(bearer(user)).send({ enabled });
  const transfer = (user: E2eUser, direction: string, amount: string) =>
    e2e.http
      .post('/trader/balances/transfer')
      .set(bearer(user))
      .send({ direction, amount });
  const journalOf = async (user: E2eUser, kind?: string) =>
    (
      await e2e.http
        .get(`/admin/users/${user.user.id}/balance-operations`)
        .set(bearer(admin))
        .query({ ...(kind && { kind }), type: 'internal' })
        .expect(200)
    ).body.data as Record<string, unknown>[];
  const auditCount = (action: string, userId: string) =>
    e2e.dataSource
      .getRepository(AuditLog)
      .count({ where: { action, targetUserId: userId } });
  const armRequisite = async (user: E2eUser): Promise<string> => {
    const deviceId = await deviceOf(e2e, user);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date(Date.now() + 3_600_000) });

    return (
      await e2e.http
        .post('/trader/requisites')
        .set(bearer(user))
        .send({
          type: 'card_or_sbp',
          bankId,
          deviceId,
          phone: '+79010000001',
          cardholderName: 'IVAN IVANOV',
          dailyAmountLimit: '1000000.00',
        })
        .expect(201)
    ).body.data.id as string;
  };
  const createPayIn = (amount = '9090') =>
    e2e.http
      .post('/v1/payment/pay-in')
      .set('X-Secure-Key', key)
      .send({
        method: 'sbp',
        amount,
        merchantTransactionId: `order-${Math.random().toString(36).slice(2)}`,
        payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
      });

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    const superadmin = await e2e.createUser(Role.Superadmin);
    merchantId = (await e2e.app.get(MerchantsService).create('Casino')).id;
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
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('1000000'));
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('deposit, transfer to insurance, switch on, traffic: each step with exact balances', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await armRequisite(trader);
    expect((await createPayIn().expect(403)).body.code).toBe(
      'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
    );
    expect((await switchTrading(trader, true).expect(409)).body.code).toBe(
      'INSURANCE_BELOW_MINIMUM',
    );

    await deposit(trader, '1000');
    expect(await balances(trader)).toEqual({
      main: '1000.000000',
      mainReserved: '0.000000',
      available: '1000.000000',
      insurancePayIn: '0.000000',
      insurancePayOut: '0.000000',
      rate: '90.900000',
    });

    const moved = await transfer(
      trader,
      'main_to_insurance_pay_in',
      '600.5',
    ).expect(201);

    expect(moved.body.data).toEqual(
      expect.objectContaining({
        type: 'transfer',
        direction: 'out',
        status: 'completed',
        fromBalance: 'main',
        toBalance: 'insurance_pay_in',
        amount: '600.500000',
        address: null,
        txHash: null,
      }),
    );
    expect(await balances(trader)).toMatchObject({
      main: '399.500000',
      available: '399.500000',
      insurancePayIn: '600.500000',
    });
    expect(await journalOf(trader)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'main',
          amount: '-600.500000',
          balanceBefore: '1000.000000',
          balanceAfter: '399.500000',
        }),
        expect.objectContaining({
          kind: 'insurance_pay_in',
          amount: '600.500000',
          balanceBefore: '0.000000',
          balanceAfter: '600.500000',
        }),
      ]),
    );
    expect(await auditCount('balance.transfer', trader.user.id)).toBe(1);

    const tabs = await e2e.http
      .get('/trader/finance-operations')
      .set(bearer(trader))
      .query({ type: 'transfer' })
      .expect(200);
    expect(tabs.body.data).toEqual([
      expect.objectContaining({
        id: moved.body.data.id,
        fromBalance: 'main',
        toBalance: 'insurance_pay_in',
      }),
    ]);

    await expect(
      switchTrading(trader, true).expect(200),
    ).resolves.toMatchObject({ body: { data: { enabled: true } } });
    expect(await auditCount('activity.trading_enabled', trader.user.id)).toBe(
      1,
    );

    const summaryBefore = await summary(trader);
    expect(summaryBefore).toMatchObject({
      trading: { payIn: true, payOut: true },
      access: { payouts: true },
      blockers: [],
    });

    const issued = await createPayIn('9090').expect(201);
    const deal = await e2e.dataSource
      .getRepository(Transaction)
      .findOneOrFail({ where: { id: issued.body.data.id } });
    const reserved = deal.traderAmount.toFixed(6);
    const wallet = await walletOf(trader);

    expect(wallet.mainReserved.toFixed(6)).toBe(reserved);
    expect(wallet.lastAcceptedDealAt).toEqual(deal.createdAt);
    expect(await summary(trader)).toMatchObject({
      balance: {
        main: '399.500000',
        reserved,
        available: toCrypto('399.5').minus(reserved).toFixed(6),
      },
      counters: {
        activeDeals: 1,
        appeals: 0,
        activePayouts: 0,
        payoutAppeals: 0,
      },
    });

    await switchTrading(trader, false).expect(200);
    expect(await auditCount('activity.trading_disabled', trader.user.id)).toBe(
      1,
    );
    expect(
      (
        await e2e.dataSource
          .getRepository(Transaction)
          .findOneOrFail({ where: { id: deal.id } })
      ).status,
    ).toBe('active');
    expect((await summary(trader)).blockers).toEqual(['trading_disabled']);
    await e2e.http
      .post(`/trader/deals/${deal.id}/confirm`)
      .set(bearer(trader))
      .expect(200);

    expect((await createPayIn('9090').expect(403)).body.code).toBe(
      'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
    );

    const earlier = new Date(deal.createdAt.getTime() - DAY_MS);
    await e2e.app
      .get(DataSource)
      .transaction((manager) =>
        e2e.app
          .get(WalletService)
          .stampAcceptedDealWithin(manager, trader.user.id, earlier),
      );
    expect((await walletOf(trader)).lastAcceptedDealAt).toEqual(deal.createdAt);

    await e2e.dataSource
      .getRepository(Wallet)
      .update(
        { userId: trader.user.id },
        { lastAcceptedDealAt: null as never },
      );
    const fallback = await transfer(
      trader,
      'insurance_pay_in_to_main',
      '1',
    ).expect(409);
    expect(fallback.body).toMatchObject({
      code: 'INSURANCE_WITHDRAWAL_DELAYED',
      availableAt: new Date(
        deal.createdAt.getTime() + 14 * DAY_MS,
      ).toISOString(),
    });
  });

  it('the database refuses an own-balance transfer naming one balance twice or two accounts', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const other = await e2e.createUser(Role.Trader);
    const insert = (row: object) =>
      e2e.dataSource.getRepository(AccountTransaction).insert({
        type: AccountTransactionType.Transfer,
        status: AccountTransactionStatus.Completed,
        userId: trader.user.id,
        counterpartyUserId: trader.user.id,
        fromBalance: BalanceKind.Main,
        toBalance: BalanceKind.InsurancePayIn,
        amount: toCrypto(1),
        ...row,
      });

    await expect(insert({ toBalance: BalanceKind.Main })).rejects.toThrow(
      /own_balances_one_account_two_balances/,
    );
    await expect(insert({ counterpartyUserId: other.user.id })).rejects.toThrow(
      /own_balances_one_account_two_balances/,
    );
    await expect(insert({})).resolves.toBeDefined();
  });

  it('a repeated switch is a 200 and writes nothing; an admin’s switch-off can be undone by the trader', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(100),
      insurancePayInBalance: toCrypto(500),
    });

    await switchTrading(trader, false).expect(200);
    expect(await auditCount('activity.trading_disabled', trader.user.id)).toBe(
      0,
    );

    await switchTrading(trader, true).expect(200);
    await switchTrading(trader, true).expect(200);
    expect(await auditCount('activity.trading_enabled', trader.user.id)).toBe(
      1,
    );

    await e2e.http
      .patch(`/admin/users/${trader.user.id}/settings`)
      .set(bearer(admin))
      .send({ tradingEnabled: false })
      .expect(200);
    expect((await summary(trader)).trading.payIn).toBe(false);

    await switchTrading(trader, true).expect(200);
    expect((await summary(trader)).trading.payIn).toBe(true);
  });

  it('refuses to switch on with the balance at the threshold', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(0),
      insurancePayInBalance: toCrypto(500),
    });

    expect((await switchTrading(trader, true).expect(409)).body.code).toBe(
      'BALANCE_BELOW_THRESHOLD',
    );
    expect((await summary(trader)).trading.payIn).toBe(false);
  });

  it('holds the insurance for 14 days after the last accepted deal, then gives it back', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const accepted = new Date(Date.now() - 13 * DAY_MS);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(10),
      insurancePayInBalance: toCrypto(500),
      insurancePayOutBalance: toCrypto(300),
      lastAcceptedDealAt: accepted,
    });

    for (const direction of [
      'insurance_pay_in_to_main',
      'insurance_pay_out_to_main',
    ]) {
      const refused = await transfer(trader, direction, '100').expect(409);

      expect(refused.body).toMatchObject({
        code: 'INSURANCE_WITHDRAWAL_DELAYED',
        availableAt: new Date(accepted.getTime() + 14 * DAY_MS).toISOString(),
      });
    }

    await expect(balances(trader)).resolves.toMatchObject({
      main: '10.000000',
      insurancePayIn: '500.000000',
      insurancePayOut: '300.000000',
    });

    await e2e.dataSource
      .getRepository(Wallet)
      .update(
        { userId: trader.user.id },
        { lastAcceptedDealAt: new Date(Date.now() - 15 * DAY_MS) },
      );
    const back = await transfer(
      trader,
      'insurance_pay_out_to_main',
      '300',
    ).expect(201);

    expect(back.body.data.direction).toBe('in');
    await transfer(trader, 'insurance_pay_in_to_main', '500.000001').expect(
      409,
    );
    await expect(balances(trader)).resolves.toMatchObject({
      main: '310.000000',
      insurancePayIn: '500.000000',
      insurancePayOut: '0.000000',
    });
  });

  const dealOf = async (trader: E2eUser): Promise<Transaction> =>
    e2e.app.get(TransactionService).createDeal({
      kind: TransactionKind.PayIn,
      method: 'sbp',
      traderUserId: trader.user.id,
      bankDetailsId: await armRequisite(trader),
      merchantId,
      amountFiat: toFiat('900'),
      rate: toRate('90'),
      merchantPercent: 10,
      traderPercent: 7,
    });

  it('keeps the trader’s own insurance in place while one of their disputes is open or reviewing; an admin still moves it', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(1000),
      insurancePayInBalance: toCrypto(500),
      insurancePayOutBalance: toCrypto(300),
    });
    const deal = await dealOf(trader);
    await e2e.dataSource
      .getRepository(Wallet)
      .update(
        { userId: trader.user.id },
        { lastAcceptedDealAt: new Date(Date.now() - 15 * DAY_MS) },
      );
    const disputes = e2e.dataSource.getRepository(TransactionDispute);
    const dispute = await disputes.save({
      transactionId: deal.id,
      status: DisputeStatus.Open,
      statusBefore: TransactionStatus.Active,
      openedAt: new Date(),
    });

    for (const status of [DisputeStatus.Open, DisputeStatus.Reviewing]) {
      await disputes.update(dispute.id, { status });

      for (const direction of [
        'insurance_pay_in_to_main',
        'insurance_pay_out_to_main',
      ]) {
        const refused = await transfer(trader, direction, '10').expect(409);

        expect(refused.body).toMatchObject({
          code: 'INSURANCE_LOCKED_BY_DISPUTE',
        });
      }
    }

    await transfer(trader, 'main_to_insurance_pay_in', '10').expect(201);
    await e2e.http
      .post(`/admin/users/${trader.user.id}/balance-transfer`)
      .set(bearer(admin))
      .send({
        from: 'insurance_pay_out',
        to: 'main',
        amount: '100',
        comment: 'ticket 9',
      })
      .expect(201);

    await disputes.update(dispute.id, { status: DisputeStatus.Accepted });
    await transfer(trader, 'insurance_pay_in_to_main', '10').expect(201);

    await expect(balances(trader)).resolves.toMatchObject({
      insurancePayIn: '500.000000',
      insurancePayOut: '200.000000',
    });
  });

  it('without a stamp counts a pay-out the trader held from the start (no take) by its createdAt', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(1000),
      insurancePayInBalance: toCrypto(500),
    });
    const payIn = await dealOf(trader);
    const deals = e2e.dataSource.getRepository(Transaction);
    const createdAt = new Date(Date.now() - 3 * DAY_MS);

    await deals.update(payIn.id, {
      createdAt: new Date(Date.now() - 20 * DAY_MS),
    });
    const payOut = await deals.save(
      deals.create({
        ...payIn,
        id: undefined,
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Canceled,
        paymentPageToken: null,
        payoutTakenAt: null,
        createdAt,
      }),
    );
    expect(payOut.payoutTakenAt).toBeNull();
    await e2e.dataSource
      .getRepository(Wallet)
      .update(
        { userId: trader.user.id },
        { lastAcceptedDealAt: null as never },
      );

    const refused = await transfer(
      trader,
      'insurance_pay_in_to_main',
      '1',
    ).expect(409);
    expect(refused.body).toMatchObject({
      code: 'INSURANCE_WITHDRAWAL_DELAYED',
      availableAt: new Date(createdAt.getTime() + 14 * DAY_MS).toISOString(),
    });
  });

  it('refuses more than is available, the escrow counted, and every direction left to an admin', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(100),
      mainReserved: toCrypto(40),
    });

    expect(
      (
        await transfer(trader, 'main_to_insurance_pay_in', '60.000001').expect(
          409,
        )
      ).body.code,
    ).toBe('INSUFFICIENT_BALANCE');
    await transfer(trader, 'main_to_insurance_pay_out', '1').expect(400);
    await transfer(trader, 'insurance_pay_in_to_insurance_pay_out', '1').expect(
      400,
    );
    await e2e.http
      .post('/trader/balances/transfer')
      .set(bearer(trader))
      .send({ direction: 'main_to_insurance_pay_in', amount: 5 })
      .expect(400);
    await transfer(trader, 'main_to_insurance_pay_in', '60').expect(201);
    await expect(balances(trader)).resolves.toMatchObject({
      main: '40.000000',
      mainReserved: '40.000000',
      available: '0.000000',
      insurancePayIn: '60.000000',
    });
  });

  it('own transfers stay out of the 24-hour limit; withdrawalsEnabled off stops a withdrawal and a transfer to another trader, not one to the insurance', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const other = await e2e.createUser(Role.Trader);

    await deposit(trader, '1200');

    const otherAddress = (
      await e2e.http
        .get('/trader/deposit-address')
        .set(bearer(other))
        .expect(200)
    ).body.data.address as string;
    const withdraw = async (address: string, amount: string) =>
      e2e.http
        .post('/trader/withdrawals')
        .set(bearer(trader))
        .send({ amount, address, totp: await e2e.totp(trader) });

    await transfer(trader, 'main_to_insurance_pay_in', '1000').expect(201);
    expect((await withdraw(otherAddress, '50')).status).toBe(201);
    await expect(walletOf(other)).resolves.toMatchObject({
      mainBalance: toCrypto(50),
    });

    const settings = await e2e.http
      .patch(`/admin/users/${trader.user.id}/settings`)
      .set(bearer(admin))
      .send({ withdrawalsEnabled: false })
      .expect(200);
    expect(settings.body.data.withdrawalsEnabled).toBe(false);

    await e2e.dataSource.getRepository(User).update(trader.user.id, {
      withdrawalTotpLastStep: null,
    });
    const refused = await withdraw(DESTINATION, '10');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('WITHDRAWALS_DISABLED');
    expect((await withdraw(otherAddress, '10')).status).toBe(403);
    expect(
      (
        await e2e.http
          .get('/trader/withdrawals/quote')
          .set(bearer(trader))
          .query({ address: DESTINATION, amount: '10' })
          .expect(403)
      ).body.code,
    ).toBe('WITHDRAWALS_DISABLED');
    await e2e.http
      .get('/trader/finance-operations')
      .set(bearer(trader))
      .expect(200);
    await transfer(trader, 'main_to_insurance_pay_in', '10').expect(201);
    await expect(balances(trader)).resolves.toMatchObject({
      main: '140.000000',
      insurancePayIn: '1010.000000',
    });
  });

  it('payoutTradingEnabled off hides the pool and the badge; the switch off closes the pool too', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(TraderSettings).save({
      userId: trader.user.id,
      tradingEnabled: true,
      payoutTradingEnabled: false,
    });

    const hidden = await e2e.http
      .get('/trader/payouts/available')
      .set(bearer(trader))
      .expect(403);
    expect(hidden.body.code).toBe('PAYOUTS_ACCESS_DISABLED');
    await expect(summary(trader)).resolves.toMatchObject({
      access: { payouts: false },
      trading: { payIn: true, payOut: false },
      counters: { availablePayouts: 0 },
    });

    await e2e.dataSource
      .getRepository(TraderSettings)
      .update(
        { userId: trader.user.id },
        { tradingEnabled: false, payoutTradingEnabled: true },
      );
    const closed = await e2e.http
      .get('/trader/payouts/available')
      .set(bearer(trader))
      .expect(403);
    expect(closed.body.code).toBe('TRADING_DISABLED');
  });

  it('an admin moves any direction with a comment, at once, and it is audited', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const lead = await e2e.createUser(Role.LeadTrader);
    const superadmin = await e2e.createUser(Role.Superadmin);
    const adminMove = (userId: string, body: object, as: E2eUser = admin) =>
      e2e.http
        .post(`/admin/users/${userId}/balance-transfer`)
        .set(bearer(as))
        .send(body);

    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(1000),
      lastAcceptedDealAt: new Date(),
    });

    const moved = await adminMove(trader.user.id, {
      from: 'main',
      to: 'insurance_pay_out',
      amount: '400',
      comment: 'ticket 1',
    }).expect(201);
    expect(moved.body.data).toEqual(
      expect.objectContaining({
        userId: trader.user.id,
        counterpartyUserId: trader.user.id,
        fromBalance: 'main',
        toBalance: 'insurance_pay_out',
        amount: '400.000000',
        comment: 'ticket 1',
        actorUserId: admin.user.id,
      }),
    );
    await adminMove(
      trader.user.id,
      {
        from: 'insurance_pay_out',
        to: 'insurance_pay_in',
        amount: '150',
        comment: 'ticket 2',
      },
      superadmin,
    ).expect(201);
    await adminMove(trader.user.id, {
      from: 'insurance_pay_in',
      to: 'main',
      amount: '50',
      comment: 'ticket 3',
    }).expect(201);

    await expect(balances(trader)).resolves.toMatchObject({
      main: '650.000000',
      insurancePayIn: '100.000000',
      insurancePayOut: '250.000000',
    });
    expect(await journalOf(trader, 'insurance_pay_out')).toHaveLength(2);
    expect(await auditCount('balance.transfer', trader.user.id)).toBe(3);

    await adminMove(trader.user.id, {
      from: 'main',
      to: 'main',
      amount: '1',
      comment: 'x',
    }).expect(400);
    await adminMove(trader.user.id, {
      from: 'main',
      to: 'insurance_pay_in',
      amount: '1',
    }).expect(400);
    await adminMove(trader.user.id, {
      from: 'main',
      to: 'insurance_pay_in',
      amount: '650.000001',
      comment: 'too much',
    }).expect(409);
    await adminMove(lead.user.id, {
      from: 'main',
      to: 'insurance_pay_in',
      amount: '1',
      comment: 'a lead',
    }).expect(400);
    await adminMove(
      trader.user.id,
      { from: 'main', to: 'insurance_pay_in', amount: '1', comment: 'x' },
      trader,
    ).expect(403);
  });

  it('a suspended trader reads and cannot write; other roles have no cabinet', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const lead = await e2e.createUser(Role.LeadTrader);

    await e2e.dataSource.getRepository(User).update(trader.user.id, {
      status: UserStatus.Suspended,
    });

    await expect(summary(trader)).resolves.toMatchObject({
      blockers: expect.arrayContaining(['trader_not_active']),
    });
    await balances(trader);
    await switchTrading(trader, true).expect(403);
    await transfer(trader, 'main_to_insurance_pay_in', '1').expect(403);

    for (const [method, path] of [
      ['get', '/trader/summary'],
      ['post', '/trader/trading'],
      ['get', '/trader/balances'],
      ['post', '/trader/balances/transfer'],
    ] as const) {
      await e2e.http[method](path).set(bearer(lead)).expect(403);
      await e2e.http[method](path).set(bearer(admin)).expect(403);
      await e2e.http[method](path).expect(401);
    }
  });

  it('the old paths are gone', async () => {
    const trader = await e2e.createUser(Role.Trader);

    for (const path of [
      '/bank-details',
      '/bank-details/tags',
      '/devices',
      '/users/me/deposit-address',
      '/users/me/finance-operations',
      '/users/me/withdrawals/1',
      '/users/me/deposits/1',
    ]) {
      await e2e.http.get(path).set(bearer(trader)).expect(404);
    }
  });
});
