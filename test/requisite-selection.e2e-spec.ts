import { randomUUID } from 'crypto';
import { Not } from 'typeorm';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { toRate } from '../src/common/utils/to-rate';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantAttachmentMethod } from '../src/merchants/entities/merchant-attachment-method.entity';
import { MerchantAttachment } from '../src/merchants/entities/merchant-attachment.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { MerchantAttachmentKind } from '../src/merchants/types/merchant-attachment-kind.enum';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { SelectionAttempt } from '../src/transactions/entities/selection-attempt.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { NoRequisiteFoundError } from '../src/transactions/exceptions/no-requisite-found.exception';
import { RequisiteSelectionService } from '../src/transactions/services/requisite-selection.service';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { SelectionFilter } from '../src/transactions/types/selection-filter.enum';
import { SelectionOutcome } from '../src/transactions/types/selection-outcome.enum';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../src/transactions/types/transaction-status.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('requisite selection against Postgres', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let first: E2eUser;
  let merchantId: string;
  let bankId: number;
  let firstRequisite: string;
  let secondRequisite: string;

  const selection = () => e2e.app.get(RequisiteSelectionService);

  const issue = (amount: number, requestId: string | null = null) =>
    selection().issue({
      requestId,
      merchantId,
      method: 'sbp',
      amountFiat: toFiat(amount),
      rate: toRate(90),
      merchantPercent: 10,
    });

  const trader = async (phone: string): Promise<[E2eUser, string]> => {
    const user = await e2e.createUser(Role.Trader);
    const deviceId = await deviceOf(e2e, user);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date() });
    await e2e.dataSource.getRepository(TraderSettings).save({
      userId: user.user.id,
      tradingEnabled: true,
    });
    await e2e.dataSource.getRepository(Wallet).save({
      userId: user.user.id,
      mainBalance: toCrypto(100000),
      insurancePayInBalance: toCrypto(1000),
    });
    const requisite = (
      await e2e.http
        .post('/trader/requisites')
        .set(bearer(user))
        .send({
          type: 'card_or_sbp',
          bankId,
          deviceId,
          phone,
          dailyAmountLimit: '1000000.00',
          maxActiveTransactionsEnabled: true,
          maxActiveTransactions: 1,
        })
        .expect(201)
    ).body.data.id as string;

    return [user, requisite];
  };

  const dealsOn = (bankDetailsId: string) =>
    e2e.dataSource.getRepository(Transaction).count({
      where: { bankDetailsId, status: Not(TransactionStatus.Canceled) },
    });

  const cancelAll = () =>
    e2e.dataSource.query(`UPDATE transactions SET status = 'canceled'`);

  const setActive = (bankDetailsId: string, active: boolean) =>
    e2e.dataSource.query('UPDATE bank_details SET active = $1 WHERE id = $2', [
      active,
      bankDetailsId,
    ]);

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    merchantId = (await e2e.app.get(MerchantsService).create('Мерчант S5')).id;

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
    await e2e.dataSource.getRepository(MethodRate).save({
      scope: RateScope.Trader,
      method: 'sbp',
      payInPercent: 7,
      payOutPercent: 0,
    });

    [first, firstRequisite] = await trader('+79010000001');
    [, secondRequisite] = await trader('+79010000002');

    const attachment = await e2e.dataSource
      .getRepository(MerchantAttachment)
      .save({
        merchantId,
        userId: first.user.id,
        kind: MerchantAttachmentKind.Trader,
        trading: true,
      });
    await e2e.dataSource.getRepository(MerchantAttachmentMethod).save({
      attachmentId: attachment.id,
      method: 'sbp',
      enabled: true,
    });
  });

  afterAll(() => e2e?.close());

  afterEach(async () => {
    await cancelAll();
    await setActive(firstRequisite, true);
    await setActive(secondRequisite, true);
  });

  it('issues to the attached trader and journals the attempt', async () => {
    const issued = await issue(1000);

    expect(issued.transaction).toMatchObject({
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      traderUserId: first.user.id,
      bankDetailsId: firstRequisite,
      traderPercent: 7,
    });
    expect(issued.summary).toMatchObject({
      considered: 2,
      dropped: {},
      attempted: 1,
      issuedBankDetailsId: firstRequisite,
    });

    const rows = await e2e.dataSource
      .getRepository(SelectionAttempt)
      .find({ where: { transactionId: issued.transaction.id } });
    expect(rows).toMatchObject([
      {
        traderUserId: first.user.id,
        bankDetailsId: firstRequisite,
        outcome: SelectionOutcome.Issued,
        reason: null,
      },
    ]);
  });

  it('two parallel selections on a requisite with maxActiveTransactions = 1 give one deal; the other finds nothing', async () => {
    await setActive(secondRequisite, false);

    const results = await Promise.allSettled([issue(1000), issue(1500)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(
      NoRequisiteFoundError,
    );
    expect(await dealsOn(firstRequisite)).toBe(1);
  });

  it('two parallel selections on two requisites with one slot each give one deal on each', async () => {
    const results = await Promise.all([issue(1000), issue(1500)]);

    expect(
      results.map(({ transaction }) => transaction.bankDetailsId).sort(),
    ).toEqual([firstRequisite, secondRequisite].sort());
    expect(await dealsOn(firstRequisite)).toBe(1);
    expect(await dealsOn(secondRequisite)).toBe(1);
  });

  it('re-checks under the lock: a deal written while it waits sends it to the next candidate', async () => {
    const runner = e2e.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM bank_details WHERE id = $1 FOR UPDATE', [
      firstRequisite,
    ]);

    const requestId = randomUUID();
    const pending = issue(1000, requestId);
    await waitForLockWaiter();
    await runner.manager.getRepository(Transaction).save({
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      method: 'sbp',
      traderUserId: first.user.id,
      bankDetailsId: firstRequisite,
      merchantId,
      amountFiat: toFiat(2000),
      amountCrypto: toCrypto('22.222222'),
    });
    await runner.commitTransaction();
    await runner.release();

    const issued = await pending;

    expect(issued.transaction.bankDetailsId).toBe(secondRequisite);
    expect(issued.summary.skippedUnderLock).toEqual({
      [SelectionFilter.MaxActive]: 1,
    });
    const journal = await e2e.dataSource
      .getRepository(SelectionAttempt)
      .find({ where: { requestId }, order: { id: 'ASC' } });
    expect(journal).toMatchObject([
      {
        bankDetailsId: firstRequisite,
        outcome: SelectionOutcome.Skipped,
        reason: SelectionFilter.MaxActive,
        transactionId: null,
      },
      {
        bankDetailsId: secondRequisite,
        outcome: SelectionOutcome.Issued,
        reason: null,
        transactionId: issued.transaction.id,
      },
    ]);
  });

  const waitForLockWaiter = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ waiting }] = await e2e.dataSource.query(
        `SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if (waiting > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('the selection never waited for the requisite lock');
  };
});
