import { DepositExpiryService } from '../../src/account-transactions/services/deposit-expiry.service';
import { PayoutQueueService } from '../../src/account-transactions/services/payout-queue.service';
import { SweepService } from '../../src/tron/services/sweep.service';
import { TronConfirmationTracker } from '../../src/tron/services/tron-confirmation-tracker.service';
import { UsdtTransferScanner } from '../../src/tron/services/usdt-transfer-scanner.service';
import { E2eContext, E2eUser } from './e2e-app';

export const bearer = (user: E2eUser) => ({
  Authorization: `Bearer ${user.token}`,
});

export const usdtSun = (amount: string): bigint =>
  BigInt(Math.round(Number(amount) * 1_000_000));

export const scan = (e2e: E2eContext) =>
  e2e.app.get(UsdtTransferScanner).tick();

export const confirm = (e2e: E2eContext, now?: Date) =>
  e2e.app.get(TronConfirmationTracker).tick(now);

export const payout = (e2e: E2eContext) =>
  e2e.app.get(PayoutQueueService).tick();

export const sweep = (e2e: E2eContext) => e2e.app.get(SweepService).tick();

export const expireDeposits = (e2e: E2eContext, now: Date) =>
  e2e.app.get(DepositExpiryService).tick(now);

export const mainBalance = async (
  e2e: E2eContext,
  admin: E2eUser,
  userId: string,
) =>
  (
    await e2e.http
      .get(`/admin/users/${userId}/balances`)
      .set(bearer(admin))
      .expect(200)
  ).body.data;
