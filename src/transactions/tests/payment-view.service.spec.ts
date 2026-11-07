import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toFiat } from '../../common/utils/to-fiat';
import { Transaction } from '../entities/transaction.entity';
import { PaymentViewService } from '../services/payment-view.service';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const TOKEN = 'b'.repeat(43);

describe('PaymentViewService, paymentPageUrl', () => {
  const urlOf = async (base: string, token: string | null) => {
    const service = new PaymentViewService(
      { findByIdsWithDeleted: jest.fn(async () => []) } as never,
      { findByIds: jest.fn(async () => []) } as never,
      { get: () => base } as never,
    );
    const deal = {
      id: uuidOf(1),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      amountFiat: toFiat(2000),
      createdAt: new Date(),
      paymentPageToken: token,
    } as unknown as Transaction;
    const [payment] = await service.paymentsOf(
      { find: jest.fn(async () => []) } as never,
      [deal],
    );

    return payment.paymentPageUrl;
  };

  it('is the page address with the token, one slash between', async () => {
    await expect(urlOf('https://pay.example/p/', TOKEN)).resolves.toBe(
      `https://pay.example/p/${TOKEN}`,
    );
    await expect(urlOf('https://pay.example/p', TOKEN)).resolves.toBe(
      `https://pay.example/p/${TOKEN}`,
    );
  });

  it('is null without PAYMENT_PAGE_URL or without a token', async () => {
    await expect(urlOf('', TOKEN)).resolves.toBeNull();
    await expect(urlOf('https://pay.example/p', null)).resolves.toBeNull();
  });
});
