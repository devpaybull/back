import { TronWeb } from 'tronweb';
import { Role } from '../src/common/enums/role.enum';
import { User } from '../src/users/entities/user.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import {
  bearer,
  confirm,
  mainBalance,
  payout,
  scan,
  usdtSun,
} from './support/flow';
import { EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

const STRANGER = EXTERNAL_SENDER;
const DESTINATION = TronWeb.address.fromPrivateKey(
  '0'.repeat(63) + '3',
) as string;

describe('withdrawals end to end', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let superadmin: E2eUser;
  let trader: E2eUser;
  const quote = (amount: string, address = DESTINATION) =>
    e2e.http
      .get('/users/me/withdrawals/quote')
      .set(bearer(trader))
      .query({ address, amount });
  const resetCodes = () =>
    e2e.dataSource.getRepository(User).update(trader.user.id, {
      withdrawalTotpLastStep: null,
      withdrawalTotpFailures: 0,
      withdrawalTotpFailuresSince: null,
    });
  const withdraw = async (
    status: number,
    amount: string,
    address = DESTINATION,
    totp?: string,
  ) => {
    if (!totp) await resetCodes();

    return e2e.http
      .post('/users/me/withdrawals')
      .set(bearer(trader))
      .send({ amount, address, totp: totp ?? (await e2e.totp(trader)) })
      .expect(status);
  };
  const fund = async (user: E2eUser, amount: string) => {
    const address = (
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(user))
        .expect(200)
    ).body.data.address;
    e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun(amount));
    await scan(e2e);
    return address;
  };

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    superadmin = await e2e.createUser(Role.Superadmin);
    trader = await e2e.createUser(Role.Trader);
    e2e.node.usdt.set(STRANGER, usdtSun('100000'));
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('5000'));
    e2e.node.trx.set(HOT_ADDRESS, 1_000_000_000n);
    e2e.node.activated.add(HOT_ADDRESS);
    await scan(e2e);
    await fund(trader, '800');
  });

  afterAll(() => e2e.close());

  describe('quote', () => {
    it('prices the network cost of a transfer in TRX and USDT and stores the quote', async () => {
      const response = await quote('100').expect(200);

      expect(response.body.data).toEqual({
        available: '800.000000',
        fee: { trx: '27.650000', usdt: '8.295000' },
        maxAmount: '791.705000',
        internal: false,
        expiresAt: expect.any(String),
      });
    });

    it('prices a recipient that already holds USDT at half the energy', async () => {
      e2e.node.usdt.set(STRANGER, e2e.node.usdtOf(STRANGER));
      const response = await quote('100', STRANGER).expect(200);

      expect(response.body.data.fee.trx).toBe('14.000000');
    });

    it('refuses an invalid address, a platform wallet and the trader’s own deposit address', async () => {
      const own = (
        await e2e.http.get('/users/me/deposit-address').set(bearer(trader))
      ).body.data.address;

      for (const address of [
        'TNotAnAddress',
        `${DESTINATION.slice(0, -1)}${DESTINATION.endsWith('X') ? 'Y' : 'X'}`,
        HOT_ADDRESS,
        own,
      ]) {
        await quote('100', address).expect(400);
      }
      await quote('0').expect(400);
      await quote('1.0000001').expect(400);
    });
  });

  describe('request', () => {
    it('refuses a wrong code with the login message and locks after five', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await withdraw(401, '100', DESTINATION, '000000');
        expect(response.body.message).toBe(
          'Invalid login, password or one-time code',
        );
      }

      await withdraw(429, '100', DESTINATION, await e2e.totp(trader));
      await resetCodes();
    });

    it('does not accept the same code twice', async () => {
      await quote('6').expect(200);
      await resetCodes();
      const totp = await e2e.totp(trader);
      await withdraw(201, '6', DESTINATION, totp);
      await withdraw(401, '6', DESTINATION, totp);
      await resetCodes();
    });

    it('refuses without a quote (409 with the new fee), below the minimum, above the balance and the daily limit', async () => {
      const unquoted = await withdraw(409, '77');
      expect(unquoted.body.fee).toBe('8.295000');
      await resetCodes();

      await withdraw(400, '4.99');
      await resetCodes();

      await quote('790').expect(200);
      await withdraw(409, '790');
      await resetCodes();

      await quote('995').expect(200);
      const over = await withdraw(409, '995');
      expect(over.body.message).toMatch(
        /24-hour withdrawal limit|Insufficient/,
      );
      await resetCodes();
    });

    it('refuses within the security hold after a password change', async () => {
      await e2e.dataSource
        .getRepository(User)
        .update(trader.user.id, { passwordChangedAt: new Date() });
      await quote('10').expect(200);
      await withdraw(409, '10');
      await e2e.dataSource.getRepository(User).update(trader.user.id, {
        passwordChangedAt: new Date(Date.now() - 25 * 3_600_000),
      });
      await resetCodes();
    });

    it('reserves amount + fee and lets the trader cancel while pending', async () => {
      await quote('50').expect(200);
      const created = await withdraw(201, '50');
      await resetCodes();
      const balances = await mainBalance(e2e, admin, trader.user.id);

      expect(created.body.data).toEqual(
        expect.objectContaining({
          type: 'withdrawal',
          status: 'pending',
          fee: '8.295000',
        }),
      );
      expect(balances.mainReserved).toBe('72.590000');

      await e2e.http
        .post(`/users/me/withdrawals/${created.body.data.id}/cancel`)
        .set(bearer(trader))
        .expect(200);
      expect((await mainBalance(e2e, admin, trader.user.id)).mainReserved).toBe(
        '14.295000',
      );
    });
  });

  describe('auto payout', () => {
    it('sends from the hot wallet, signed by the hot key, and completes on confirmation', async () => {
      const before = await mainBalance(e2e, admin, trader.user.id);
      await payout(e2e);

      expect(e2e.node.broadcasts).toHaveLength(1);
      const [sent] = e2e.node.broadcasts;
      expect((sent.raw_data as { fee_limit: number }).fee_limit).toBe(
        50_000_000,
      );

      e2e.node.mine();
      await confirm(e2e);

      const after = await mainBalance(e2e, admin, trader.user.id);
      expect(after.mainBalance).toBe(
        (Number(before.mainBalance) - 6 - 8.295).toFixed(6),
      );
      expect(after.mainReserved).toBe('0.000000');
      expect(e2e.node.usdtOf(DESTINATION)).toBe(usdtSun('6'));

      const list = await e2e.http
        .get('/admin/withdrawals')
        .set(bearer(admin))
        .query({ status: 'completed' })
        .expect(200);
      expect(list.body.data[0]).toEqual(
        expect.objectContaining({
          status: 'completed',
          txHash: sent.txID,
          attempts: [{ txHash: sent.txID, status: 'confirmed' }],
          actions: { canPayManually: false, canReject: false },
        }),
      );

      const journal = await e2e.http
        .get(`/admin/users/${trader.user.id}/balance-operations`)
        .set(bearer(admin))
        .query({ type: 'withdrawal,withdrawal_fee' })
        .expect(200);
      expect(
        journal.body.data.map((row: { amount: string }) => row.amount).sort(),
      ).toEqual(['-6.000000', '-8.295000']);
    });

    it('marks a withdrawal failed when the transfer reverts, and an admin pays it by hand', async () => {
      await quote('20').expect(200);
      const created = await withdraw(201, '20');
      await resetCodes();
      await payout(e2e);
      e2e.node.nextResult = 'REVERT';
      e2e.node.mine();
      await confirm(e2e);

      const failed = await e2e.http
        .get('/admin/withdrawals')
        .set(bearer(admin))
        .query({ status: 'failed' })
        .expect(200);
      expect(failed.body.data[0]).toEqual(
        expect.objectContaining({
          id: created.body.data.id,
          statusReason: 'network_failed',
          actions: { canPayManually: true, canReject: true },
        }),
      );
      expect((await mainBalance(e2e, admin, trader.user.id)).mainReserved).toBe(
        '24.200000',
      );

      const tooSmall = e2e.node.externalUsdtTransfer(
        STRANGER,
        DESTINATION,
        usdtSun('19'),
      );
      const paid = e2e.node.externalUsdtTransfer(
        STRANGER,
        DESTINATION,
        usdtSun('20'),
      );
      const id = created.body.data.id;

      await e2e.http
        .post(`/admin/withdrawals/${id}/complete-manually`)
        .set(bearer(admin))
        .send({ txHash: tooSmall })
        .expect(400);
      const verdict = await e2e.http
        .post(`/admin/withdrawals/${id}/verify`)
        .set(bearer(admin))
        .send({ txHash: paid })
        .expect(200);
      expect(verdict.body.data).toEqual(
        expect.objectContaining({ acceptable: true, amount: '20.000000' }),
      );
      await e2e.http
        .post(`/admin/withdrawals/${id}/complete-manually`)
        .set(bearer(trader))
        .send({ txHash: paid })
        .expect(403);
      const closed = await e2e.http
        .post(`/admin/withdrawals/${id}/complete-manually`)
        .set(bearer(admin))
        .send({ txHash: paid })
        .expect(200);
      expect(closed.body.data).toEqual(
        expect.objectContaining({ status: 'completed', paidManually: true }),
      );
      expect((await mainBalance(e2e, admin, trader.user.id)).mainReserved).toBe(
        '0.000000',
      );
      await e2e.http
        .post(`/admin/withdrawals/${id}/complete-manually`)
        .set(bearer(admin))
        .send({ txHash: paid })
        .expect(409);
    });

    it('refuses manual payout of a pending withdrawal and rejects a failed one', async () => {
      await quote('15').expect(200);
      const created = await withdraw(201, '15');
      await resetCodes();
      const id = created.body.data.id;
      const hash = e2e.node.externalUsdtTransfer(
        STRANGER,
        DESTINATION,
        usdtSun('15'),
      );

      await e2e.http
        .post(`/admin/withdrawals/${id}/complete-manually`)
        .set(bearer(admin))
        .send({ txHash: hash })
        .expect(409);

      e2e.node.nextBuildTamper = 'hex';
      await payout(e2e);
      expect(e2e.node.broadcasts).toHaveLength(2);

      const rejected = await e2e.http
        .post(`/admin/withdrawals/${id}/reject`)
        .set(bearer(admin))
        .send({ reason: '  node built another transfer  ' })
        .expect(200);
      expect(rejected.body.data).toEqual(
        expect.objectContaining({
          status: 'canceled',
          statusReason: 'rejected_by_admin',
          comment: 'node built another transfer',
        }),
      );
      expect((await mainBalance(e2e, admin, trader.user.id)).mainReserved).toBe(
        '0.000000',
      );
    });

    it('refuses to sign a transfer the node built to another recipient', async () => {
      await quote('12').expect(200);
      const created = await withdraw(201, '12');
      await resetCodes();
      e2e.node.nextBuildTamper = 'recipient';
      await payout(e2e);

      expect(e2e.node.broadcasts).toHaveLength(2);
      const row = await e2e.http
        .get(`/users/me/withdrawals/${created.body.data.id}`)
        .set(bearer(trader))
        .expect(200);
      expect(row.body.data).toEqual(
        expect.objectContaining({ status: 'failed', statusReason: 'error' }),
      );
    });

    it('reports the queue in the KPIs', async () => {
      const stats = await e2e.http
        .get('/admin/withdrawals/stats')
        .set(bearer(admin))
        .expect(200);
      expect(stats.body.data).toEqual(
        expect.objectContaining({
          mode: 'auto',
          manualReview: 0,
          failed: 1,
          queued: 0,
        }),
      );
    });
  });

  describe('internal transfer to another trader’s deposit address', () => {
    it('moves the money at once, without a fee or the network', async () => {
      const recipient = await e2e.createUser(Role.Trader);
      const address = (
        await e2e.http
          .get('/users/me/deposit-address')
          .set(bearer(recipient))
          .expect(200)
      ).body.data.address;

      const quoted = await quote('30', address).expect(200);
      expect(quoted.body.data).toEqual(
        expect.objectContaining({
          internal: true,
          fee: { usdt: '0.000000', trx: '0.000000' },
        }),
      );
      const moved = await withdraw(201, '30', address);
      await resetCodes();

      expect(moved.body.data).toEqual(
        expect.objectContaining({
          type: 'transfer',
          direction: 'out',
          status: 'completed',
        }),
      );
      expect(
        (await mainBalance(e2e, admin, recipient.user.id)).mainBalance,
      ).toBe('30.000000');

      const recipientHistory = await e2e.http
        .get('/users/me/finance-operations')
        .set(bearer(recipient))
        .expect(200);
      expect(recipientHistory.body.data[0]).toEqual(
        expect.objectContaining({
          type: 'transfer',
          direction: 'in',
          amount: '30.000000',
        }),
      );
    });
  });

  describe('history and admin surface', () => {
    it('shows the trader their own operations with tab counts', async () => {
      const counts = await e2e.http
        .get('/users/me/finance-operations/stats')
        .set(bearer(trader))
        .expect(200);
      expect(counts.body.data).toEqual(
        expect.objectContaining({
          deposit: 1,
          transfer: 1,
          withdrawal: expect.any(Number),
        }),
      );
    });

    it('answers someone else’s withdrawal with 404 and refuses traders on admin routes', async () => {
      const other = await e2e.createUser(Role.Trader);
      const list = await e2e.http
        .get('/users/me/finance-operations')
        .set(bearer(trader))
        .query({ type: 'withdrawal' })
        .expect(200);
      const id = list.body.data[0].id;

      await e2e.http
        .get(`/users/me/withdrawals/${id}`)
        .set(bearer(other))
        .expect(404);
      await e2e.http
        .post(`/users/me/withdrawals/${id}/cancel`)
        .set(bearer(other))
        .expect(404);
      await e2e.http.get('/admin/withdrawals').set(bearer(trader)).expect(403);
      await e2e.http
        .post(`/admin/withdrawals/${id}/reject`)
        .set(bearer(superadmin))
        .send({ reason: '' })
        .expect(400);
    });

    it('exports the withdrawals as CSV', async () => {
      const csv = await e2e.http
        .get('/admin/withdrawals/export')
        .set(bearer(admin))
        .expect(200);
      expect(csv.text.split('\r\n').length).toBeGreaterThan(3);
    });
  });
});
