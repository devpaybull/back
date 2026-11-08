import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderActivityController } from '../controllers/trader-activity.controller';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
};

const recordOf = (
  action: string,
  metadata: Record<string, unknown> | null,
) => ({
  id: 1,
  source: 'domain',
  actorUserId: trader.id,
  impersonatorUserId: null,
  targetUserId: trader.id,
  action,
  reason: null,
  metadata,
  method: null,
  path: null,
  params: null,
  statusCode: null,
  ip: '203.0.113.7',
  userAgent: 'curl',
  login: null,
  body: null,
  createdAt: new Date('2026-11-08T09:00:00Z'),
});

const build = (records: ReturnType<typeof recordOf>[]) => {
  const audit = {
    list: jest.fn(
      async () =>
        new Page(records, {
          total: records.length,
          page: 1,
          limit: 20,
          pages: 1,
        }),
    ),
  };

  return { audit, controller: new TraderActivityController(audit as never) };
};

describe('TraderActivityController', () => {
  it('is the trader’s alone', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderActivityController),
    ).toEqual([Role.Trader]);
  });

  it('reads the trader’s own rows and the system’s, and of an admin’s only the money ones', async () => {
    const { audit, controller } = build([]);

    await controller.activity(trader, {
      page: 2,
      limit: 10,
      sortOrder: SortOrder.Asc,
    });

    expect(audit.list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      sortBy: AuditSortField.CreatedAt,
      sortOrder: SortOrder.Asc,
      targetUserId: trader.id,
      actorUserIdOrSystem: trader.id,
      actions: expect.arrayContaining([
        'trader_activity.login',
        'trader_activity.logout',
        'activity.trading_enabled',
        'activity.bank_details_added',
        'bank_details.updated',
        'activity.device_added',
        'trader.deal_declined',
        'trader.payout_taken',
        'trader.appeal_contested',
        'balance.transfer',
      ]),
      anyActorActions: [
        'activity.deposit_credited',
        'activity.withdrawal_completed',
      ],
    });
    const [[{ actions }]] = audit.list.mock.calls as unknown as [
      [{ actions: string[] }],
    ];
    expect(actions).not.toContain('activity.deposit_credited');
    expect(actions).not.toContain('activity.withdrawal_completed');
    expect(actions).not.toContain('counterparty.requisite_bound');
    expect(actions).not.toContain('withdrawal.completed_manually');
  });

  it('keeps only the fields the trader may read: no IP, no merchant, no technical ids', async () => {
    const { controller } = build([
      recordOf('trader.deal_declined', {
        transactionId: uuidOf(5),
        reasonCode: 'limit_reached',
        comment: null,
        merchantId: uuidOf(6),
      }),
      recordOf('activity.withdrawal_completed', {
        accountTransactionId: 17,
        txHash: 'abc',
        amount: '10.000000',
        fee: '1.000000',
      }),
      recordOf('trader_activity.login', null),
    ]);

    const page = await controller.activity(trader, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    });

    expect(page.items).toEqual([
      {
        id: 1,
        action: 'trader.deal_declined',
        details: {
          transactionId: uuidOf(5),
          reasonCode: 'limit_reached',
          comment: null,
        },
        createdAt: new Date('2026-11-08T09:00:00Z'),
      },
      {
        id: 1,
        action: 'activity.withdrawal_completed',
        details: { amount: '10.000000', fee: '1.000000' },
        createdAt: new Date('2026-11-08T09:00:00Z'),
      },
      {
        id: 1,
        action: 'trader_activity.login',
        details: {},
        createdAt: new Date('2026-11-08T09:00:00Z'),
      },
    ]);
    expect(JSON.stringify(page.items)).not.toContain('203.0.113.7');
  });
});
