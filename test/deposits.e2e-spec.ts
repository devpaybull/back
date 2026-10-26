import { Role } from '../src/common/enums/role.enum';
import { UserStatus } from '../src/users/types/user-status.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import {
  bearer,
  expireDeposits,
  mainBalance,
  scan,
  usdtSun,
} from './support/flow';
import { EXTERNAL_SENDER, depositAddressAt } from './support/keys';

const STRANGER = EXTERNAL_SENDER;

describe('deposits end to end', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let address: string;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    e2e.node.usdt.set(STRANGER, usdtSun('100000'));
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  describe('the deposit address', () => {
    it('issues the first HD address on first use, with a QR, and keeps it', async () => {
      const first = await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(trader))
        .expect(200);
      const second = await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(trader))
        .expect(200);

      address = first.body.data.address;
      expect(address).toBe(depositAddressAt(0));
      expect(first.body.data.network).toBe('TRC20');
      expect(first.body.data.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(second.body.data.address).toBe(address);
    });

    it('gives a second trader the next index', async () => {
      const other = await e2e.createUser(Role.LeadTrader);
      const response = await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(other))
        .expect(200);

      expect(response.body.data.address).toBe(depositAddressAt(1));
    });

    it('refuses a suspended trader without an address, answers one with an address', async () => {
      const suspended = await e2e.createUser(Role.Trader, {
        status: UserStatus.Suspended,
      });
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(suspended))
        .expect(403);
      await e2e.http
        .post('/users/me/deposits')
        .set(bearer(suspended))
        .send({ amount: '50' })
        .expect(403);
    });

    it('is not reachable for an admin or anonymously', async () => {
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(admin))
        .expect(403);
      await e2e.http.get('/users/me/deposit-address').expect(401);
    });
  });

  describe('requests', () => {
    it('refuses below the minimum, a JSON number, too many decimals and unknown fields', async () => {
      for (const body of [
        { amount: '9.99' },
        { amount: 50 },
        { amount: '50.0000001' },
        { amount: '50', userId: admin.user.id },
        {},
      ]) {
        await e2e.http
          .post('/users/me/deposits')
          .set(bearer(trader))
          .send(body)
          .expect(400);
      }
    });

    it('opens requests up to DEPOSIT_MAX_ACTIVE_REQUESTS, then 409', async () => {
      const first = await e2e.http
        .post('/users/me/deposits')
        .set(bearer(trader))
        .send({ amount: '500' })
        .expect(201);
      await e2e.http
        .post('/users/me/deposits')
        .set(bearer(trader))
        .send({ amount: '120.5' })
        .expect(201);
      await e2e.http
        .post('/users/me/deposits')
        .set(bearer(trader))
        .send({ amount: '10' })
        .expect(409);

      expect(first.body.data).toEqual(
        expect.objectContaining({
          amount: '500.000000',
          status: 'pending',
          address,
          network: 'TRC20',
        }),
      );
      expect(new Date(first.body.data.expiresAt).getTime()).toBeGreaterThan(
        Date.now() + 44 * 60_000,
      );
    });

    it('answers another trader’s request with a 404', async () => {
      const other = await e2e.createUser(Role.Trader);
      const list = await e2e.http
        .get('/users/me/finance-operations')
        .set(bearer(trader))
        .expect(200);
      const id = list.body.data[0].id;

      await e2e.http
        .get(`/users/me/deposits/${id}`)
        .set(bearer(other))
        .expect(404);
      await e2e.http
        .post(`/users/me/deposits/${id}/cancel`)
        .set(bearer(other))
        .expect(404);
    });
  });

  describe('crediting', () => {
    it('credits a transfer to the request with the same amount, not the oldest', async () => {
      const before = await mainBalance(e2e, admin, trader.user.id).catch(
        () => null,
      );
      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('120.5'));
      await scan(e2e);

      const history = await e2e.http
        .get('/users/me/finance-operations')
        .set(bearer(trader))
        .query({ type: 'deposit', sortOrder: 'asc' })
        .expect(200);
      const [oldest, matched] = history.body.data;

      expect(before).toBeNull();
      expect(oldest.status).toBe('pending');
      expect(matched).toEqual(
        expect.objectContaining({
          status: 'completed',
          amount: '120.500000',
          direction: 'in',
        }),
      );
      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '120.500000',
      );
    });

    it('credits a transfer without a matching amount to the oldest live request', async () => {
      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('300'));
      await scan(e2e);

      const history = await e2e.http
        .get('/users/me/finance-operations')
        .set(bearer(trader))
        .query({ type: 'deposit', status: 'completed', sortOrder: 'asc' })
        .expect(200);

      expect(
        history.body.data.map((row: { amount: string }) => row.amount),
      ).toEqual(['300.000000', '120.500000']);
    });

    it('credits a transfer with no live request as a deposit without a request', async () => {
      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('25'));
      await scan(e2e);

      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '445.500000',
      );
    });

    it('accumulates transfers below the minimum and credits them once the sum reaches it', async () => {
      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('4'));
      await scan(e2e);
      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('3'));
      await scan(e2e);

      const accumulating = await e2e.http
        .get('/admin/deposits')
        .set(bearer(admin))
        .query({ statusReason: 'below_minimum' })
        .expect(200);
      expect(accumulating.body.data).toHaveLength(1);
      expect(accumulating.body.data[0].amountReceived).toBe('7.000000');
      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '445.500000',
      );

      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('3.5'));
      await scan(e2e);

      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '456.000000',
      );
      const credited = await e2e.http
        .get('/admin/deposits')
        .set(bearer(admin))
        .query({
          search: address.slice(5, 15),
          sortBy: 'amount',
          sortOrder: 'asc',
        })
        .expect(200);
      const accumulated = credited.body.data.find(
        (row: { transfers: unknown[] }) => row.transfers.length === 3,
      );
      expect(accumulated).toEqual(
        expect.objectContaining({
          status: 'completed',
          creditedAmount: '10.500000',
        }),
      );
    });

    it('ignores a reverted transfer and a transfer to an address nobody owns', async () => {
      e2e.node.externalUsdtTransfer(
        STRANGER,
        address,
        usdtSun('999'),
        'REVERT',
      );
      e2e.node.externalUsdtTransfer(
        STRANGER,
        depositAddressAt(40),
        usdtSun('999'),
      );
      await scan(e2e);

      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '456.000000',
      );
    });

    it('does not move the cursor past a block whose infos do not match its transactions', async () => {
      const hash = e2e.node.externalUsdtTransfer(
        STRANGER,
        address,
        usdtSun('50'),
      );
      e2e.node.dropInfosOfBlock = e2e.node.head;
      await scan(e2e);
      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '456.000000',
      );

      e2e.node.dropInfosOfBlock = null;
      await scan(e2e);
      await scan(e2e);

      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '506.000000',
      );
      const journal = await e2e.http
        .get(`/admin/users/${trader.user.id}/balance-operations`)
        .set(bearer(admin))
        .query({ type: 'deposit' })
        .expect(200);
      expect(journal.body.data).toHaveLength(5);
      expect(journal.body.data[0].reference.accountTransactionId).toEqual(
        expect.any(Number),
      );
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('writes the deposit into the trader’s activity feed', async () => {
      const feed = await e2e.http
        .get(`/admin/users/${trader.user.id}/activity`)
        .set(bearer(admin))
        .expect(200);

      expect(
        feed.body.data.filter(
          (row: { action: string }) =>
            row.action === 'activity.deposit_credited',
        ).length,
      ).toBe(5);
    });
  });

  describe('expiry and cancel', () => {
    it('expires a request whose window has passed and still credits a late transfer', async () => {
      await e2e.http
        .post('/users/me/deposits')
        .set(bearer(trader))
        .send({ amount: '600' })
        .expect(201);
      await expireDeposits(e2e, new Date(Date.now() + 46 * 60_000));
      const pending = await e2e.http
        .get('/users/me/finance-operations')
        .set(bearer(trader))
        .query({ type: 'deposit', status: 'canceled' })
        .expect(200);
      expect(pending.body.data[0].statusReason).toBe('expired');

      e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun('500'));
      await scan(e2e);
      expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
        '1006.000000',
      );
    });

    it('lets the trader cancel only a pending request', async () => {
      const opened = await e2e.http
        .post('/users/me/deposits')
        .set(bearer(trader))
        .send({ amount: '42' })
        .expect(201);
      const id = opened.body.data.id;

      const canceled = await e2e.http
        .post(`/users/me/deposits/${id}/cancel`)
        .set(bearer(trader))
        .expect(200);
      expect(canceled.body.data).toEqual(
        expect.objectContaining({
          status: 'canceled',
          statusReason: 'canceled_by_user',
        }),
      );
      await e2e.http
        .post(`/users/me/deposits/${id}/cancel`)
        .set(bearer(trader))
        .expect(409);
    });
  });

  describe('the admin page', () => {
    it('lists with status filters and search, counts the KPIs and exports CSV', async () => {
      const completed = await e2e.http
        .get('/admin/deposits')
        .set(bearer(admin))
        .query({ status: 'completed', sortBy: 'user', limit: 100 })
        .expect(200);
      expect(completed.body.meta.total).toBe(6);
      expect(completed.body.data[0].user).toEqual(
        expect.objectContaining({ id: trader.user.id, login: trader.login }),
      );

      const byLogin = await e2e.http
        .get('/admin/deposits')
        .set(bearer(admin))
        .query({ search: trader.login })
        .expect(200);
      expect(byLogin.body.meta.total).toBeGreaterThanOrEqual(6);

      const stats = await e2e.http
        .get('/admin/deposits/stats')
        .set(bearer(admin))
        .expect(200);
      expect(stats.body.data).toEqual(
        expect.objectContaining({
          problem: 0,
          completedLast24h: { count: 6, amount: '1006.000000' },
        }),
      );

      const csv = await e2e.http
        .get('/admin/deposits/export')
        .set(bearer(admin))
        .expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.split('\r\n')[0]).toBe(
        'id,status,statusReason,user,address,amount,fee,txHash,createdAt,completedAt',
      );
    });

    it('refuses a bad filter', async () => {
      await e2e.http
        .get('/admin/deposits')
        .set(bearer(admin))
        .query({ status: 'credited' })
        .expect(400);
      await e2e.http
        .get('/admin/deposits')
        .set(bearer(admin))
        .query({ createdFrom: '2026-10-02', createdTo: '2026-10-01' })
        .expect(400);
    });
  });

  describe('manual credit by hash', () => {
    it('credits a transfer the scanner missed, once', async () => {
      const late = await e2e.createUser(Role.Trader);
      const lateAddress = (
        await e2e.http
          .get('/users/me/deposit-address')
          .set(bearer(late))
          .expect(200)
      ).body.data.address;
      const hash = e2e.node.externalUsdtTransfer(
        STRANGER,
        lateAddress,
        usdtSun('77'),
      );
      e2e.node.blocks.get(e2e.node.head)!.length = 0;
      e2e.node.byId.get(hash)!.blockNumber = e2e.node.head;
      await scan(e2e);
      e2e.node.byId.set(hash, e2e.node.byId.get(hash)!);

      const verdict = await e2e.http
        .post('/admin/deposits/verify-by-hash')
        .set(bearer(admin))
        .send({ txHash: hash.toUpperCase() })
        .expect(200);
      expect(verdict.body.data).toEqual(
        expect.objectContaining({
          status: 'confirmed',
          acceptable: true,
          candidates: [
            expect.objectContaining({
              address: lateAddress,
              amount: '77.000000',
              alreadyCredited: false,
            }),
          ],
        }),
      );

      const credited = await e2e.http
        .post('/admin/deposits/credit-by-hash')
        .set(bearer(admin))
        .send({ txHash: hash })
        .expect(200);
      expect(credited.body.data[0]).toEqual(
        expect.objectContaining({
          status: 'completed',
          creditedAmount: '77.000000',
          actor: expect.objectContaining({ id: admin.user.id }),
        }),
      );
      expect((await mainBalance(e2e, admin, late.user.id)).mainBalance).toBe(
        '77.000000',
      );

      await e2e.http
        .post('/admin/deposits/credit-by-hash')
        .set(bearer(admin))
        .send({ txHash: hash })
        .expect(409);
    });

    it('refuses an unknown hash, a malformed hash and a trader', async () => {
      await e2e.http
        .post('/admin/deposits/credit-by-hash')
        .set(bearer(admin))
        .send({ txHash: 'ab'.repeat(32) })
        .expect(409);
      await e2e.http
        .post('/admin/deposits/credit-by-hash')
        .set(bearer(admin))
        .send({ txHash: 'not-a-hash' })
        .expect(400);
      await e2e.http
        .post('/admin/deposits/credit-by-hash')
        .set(bearer(trader))
        .send({ txHash: 'ab'.repeat(32) })
        .expect(403);
    });
  });
});
