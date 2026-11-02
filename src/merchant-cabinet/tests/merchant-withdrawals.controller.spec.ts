import { NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { UserStatus } from '../../users/types/user-status.enum';
import { MerchantWithdrawalsController } from '../controllers/merchant-withdrawals.controller';
import { MerchantWithdrawalSortField } from '../types/merchant-withdrawal-sort-field.enum';

const MERCHANT = uuidOf(30);
const EXTERNAL = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const user: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'shop',
  role: Role.Merchant,
  status: UserStatus.Active,
};
const row = {
  id: 41,
  type: AccountTransactionType.Withdrawal,
  status: AccountTransactionStatus.Pending,
  statusReason: null,
  userId: user.id,
  merchantId: MERCHANT,
  amount: toCrypto('5000.5'),
  fee: toCrypto('0.2883'),
  address: EXTERNAL,
  txHash: null,
  createdAt: new Date('2026-09-11T12:45:00Z'),
  completedAt: null,
} as AccountTransaction;

describe('MerchantWithdrawalsController', () => {
  const build = () => {
    const withdrawals = {
      quoteForMerchant: jest.fn(async () => ({
        available: toCrypto(500),
        fee: { usdt: toCrypto('0.2883'), trx: toCrypto('0.8452') },
        maxAmount: toCrypto('499.7117'),
        internal: false,
        expiresAt: new Date('2026-09-11T12:46:00Z'),
      })),
      requestForMerchant: jest.fn(async () => row),
      findOwnForMerchant: jest.fn(async () => row),
      cancelOwnForMerchant: jest.fn(async () => ({
        ...row,
        status: AccountTransactionStatus.Canceled,
      })),
    };
    const operations = {
      list: jest.fn(async () => toPage([[row], 1], { page: 1, limit: 20 })),
    };
    const config = { getOrThrow: jest.fn(() => 'Europe/Moscow') };

    return {
      withdrawals,
      operations,
      controller: new MerchantWithdrawalsController(
        withdrawals as never,
        operations as never,
        config as never,
      ),
    };
  };

  it.each(['quote', 'create', 'cancel'] as const)(
    '%s is the merchant account’s alone and a write',
    (handler) => {
      const method = MerchantWithdrawalsController.prototype[handler];

      expect(Reflect.getMetadata(ROLES_METADATA_KEY, method)).toEqual([
        Role.Merchant,
      ]);
      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, method)).toBe(true);
    },
  );

  it('requests a withdrawal on behalf of the merchant by the signed-in account', async () => {
    const { controller, withdrawals } = build();

    const created = await controller.create(
      MERCHANT,
      { amount: '5000.50', address: EXTERNAL, totp: '123456' },
      user,
    );

    expect(withdrawals.requestForMerchant).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      userId: user.id,
      address: EXTERNAL,
      amount: toCrypto('5000.5'),
      totp: '123456',
    });
    expect(created).toEqual({
      id: 41,
      address: EXTERNAL,
      amount: '5000.500000',
      fee: '0.288300',
      status: AccountTransactionStatus.Pending,
      statusReason: null,
      createdAt: new Date('2026-09-11T12:45:00Z'),
      completedAt: null,
      txHash: null,
    });
  });

  it('quotes against the merchant balance', async () => {
    const { controller, withdrawals } = build();

    const quote = await controller.quote(
      MERCHANT,
      { address: EXTERNAL, amount: '100.00' },
      user,
    );

    expect(withdrawals.quoteForMerchant).toHaveBeenCalledWith(
      MERCHANT,
      user.id,
      EXTERNAL,
      toCrypto(100),
    );
    expect(quote.fee).toEqual({ usdt: '0.288300', trx: '0.845200' });
  });

  it('lists only the merchant’s requests', async () => {
    const { controller, operations } = build();

    await controller.list(MERCHANT, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: MerchantWithdrawalSortField.Amount,
      search: 'sa22',
      createdFrom: '2026-09-11',
    });

    expect(operations.list).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AccountTransactionType.Withdrawal,
        merchantId: MERCHANT,
        sortBy: AccountTransactionSortField.Amount,
        search: 'sa22',
        createdFrom: new Date('2026-09-10T21:00:00Z'),
      }),
    );
  });

  it('cancels as the account, scoped to the merchant', async () => {
    const { controller, withdrawals } = build();

    await controller.cancel(MERCHANT, 41, user);

    expect(withdrawals.cancelOwnForMerchant).toHaveBeenCalledWith(
      41,
      MERCHANT,
      user.id,
    );
  });

  it('answers an id beyond int4 with a 404 before any query', async () => {
    const { controller, withdrawals } = build();

    await expect(controller.findOne(MERCHANT, 2_147_483_648)).rejects.toThrow(
      NotFoundException,
    );
    expect(withdrawals.findOwnForMerchant).not.toHaveBeenCalled();
  });
});
