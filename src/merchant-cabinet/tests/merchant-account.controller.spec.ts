import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { MerchantAccountController } from '../controllers/merchant-account.controller';

const MERCHANT = uuidOf(30);
const user: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'shop',
  role: Role.MerchantSupport,
  status: UserStatus.Active,
};

const counts = (values: Partial<Record<TransactionStatus, number>>) =>
  Object.fromEntries(
    Object.values(TransactionStatus).map((status) => [
      status,
      values[status] ?? 0,
    ]),
  );

describe('MerchantAccountController', () => {
  const build = () => {
    const merchants = {
      findById: jest.fn(async () => ({ id: MERCHANT, name: 'Casino' })),
    };
    const balances = {
      statesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              {
                balance: toCrypto('120500.5'),
                escrow: toCrypto(10),
                withdrawalReserved: toCrypto('500.5'),
              },
            ],
          ]),
      ),
    };
    const deals = {
      statusCounts: jest.fn(async () =>
        counts({
          [TransactionStatus.Active]: 10,
          [TransactionStatus.Pending]: 2,
          [TransactionStatus.Dispute]: 1,
          [TransactionStatus.ManualReview]: 1,
          [TransactionStatus.Success]: 50,
        }),
      ),
    };
    const directory = {
      findById: jest.fn(async () => ({
        id: user.id,
        telegramUsername: 'shop',
        email: null,
        role: Role.MerchantSupport,
        createdAt: new Date('2026-09-21T00:00:00Z'),
      })),
    };
    const audit = {
      list: jest.fn(async () =>
        toPage(
          [
            [
              {
                id: 7,
                action: 'merchant_activity.login',
                metadata: null,
                createdAt: new Date('2026-11-02T10:00:00Z'),
              },
            ],
            1,
          ],
          { page: 1, limit: 20 },
        ),
      ),
    };

    return {
      audit,
      deals,
      controller: new MerchantAccountController(
        merchants as never,
        balances as never,
        deals as never,
        directory as never,
        audit as never,
      ),
    };
  };

  it('is open to every merchant-side role', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, MerchantAccountController),
    ).toEqual([Role.Merchant, Role.MerchantSupport, Role.MerchantAgent]);
  });

  it('answers the header: the merchant, the role, the balance and the menu badges', async () => {
    const { controller, deals } = build();

    expect(await controller.me(MERCHANT, user)).toEqual({
      merchant: { id: MERCHANT, name: 'Casino' },
      role: Role.MerchantSupport,
      balance: {
        available: '120500.500000',
        escrow: '10.000000',
        withdrawalReserved: '500.500000',
      },
      deals: { active: 12, disputes: 2 },
    });
    expect(deals.statusCounts).toHaveBeenCalledWith(MERCHANT);
  });

  it('answers the profile with both ids', async () => {
    const { controller } = build();

    expect(await controller.profile(MERCHANT, user)).toEqual({
      merchant: { id: MERCHANT, name: 'Casino' },
      user: {
        id: user.id,
        login: 'shop',
        role: Role.MerchantSupport,
        createdAt: new Date('2026-09-21T00:00:00Z'),
      },
    });
  });

  it('reads only the signed-in account’s own merchant activity', async () => {
    const { controller, audit } = build();

    const page = await controller.activity(user, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    });

    expect(audit.list).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: user.id,
        actions: expect.arrayContaining([
          'merchant_activity.login',
          'merchant_activity.withdrawal_rejected',
        ]),
      }),
    );
    expect(page.items[0]).toEqual({
      id: 7,
      action: 'merchant_activity.login',
      metadata: null,
      createdAt: new Date('2026-11-02T10:00:00Z'),
    });
  });
});
