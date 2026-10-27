import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantBalanceOperation } from '../../transactions/entities/merchant-balance-operation.entity';
import { MerchantBalanceOperationType } from '../../transactions/types/merchant-balance-operation-type.enum';
import { AdminMerchantBalanceController } from '../controllers/admin-merchant-balance.controller';
import { AdjustMerchantBalanceDto } from '../dto/adjust-merchant-balance.dto';
import { ListMerchantBalanceOperationsQueryDto } from '../dto/list-merchant-balance-operations-query.dto';

const MERCHANT = uuidOf(3);
const superadmin = {
  id: uuidOf(8),
  role: Role.Superadmin,
} as AuthenticatedUser;
const CREATED = new Date('2026-10-26T10:00:00Z');

const operation = {
  id: 1,
  createdAt: CREATED,
  type: MerchantBalanceOperationType.DealPayOutEscrow,
  amount: toCrypto(-400),
  balanceBefore: toCrypto(2400),
  balanceAfter: toCrypto(2000),
  escrowBefore: toCrypto(0),
  escrowAfter: toCrypto(400),
  transactionId: uuidOf(50),
  comment: null,
  actorUserId: null,
} as unknown as MerchantBalanceOperation;

const build = (merchantExists = true) => {
  const merchants = {
    findById: jest.fn(async () => (merchantExists ? { id: MERCHANT } : null)),
  };
  const balances = {
    listOperations: jest.fn(
      async () =>
        new Page([operation], { total: 1, page: 1, limit: 20, pages: 1 }),
    ),
    exportOperations: jest.fn(async () => [
      operation,
      {
        ...operation,
        id: 2,
        type: MerchantBalanceOperationType.AdminAdjustment,
        transactionId: null,
        comment: 'fix, "by hand"',
      },
    ]),
    adjust: jest.fn(async () => operation),
  };

  return {
    merchants,
    balances,
    controller: new AdminMerchantBalanceController(
      merchants as never,
      balances as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
    ),
  };
};

describe('AdminMerchantBalanceController', () => {
  const proto = AdminMerchantBalanceController.prototype;

  it('reads for admin and superadmin and adjusts for a superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMerchantBalanceController),
    ).toEqual([Role.Admin, Role.Superadmin]);
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto.adjust)).toEqual([
      Role.Superadmin,
    ]);
    expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, proto.adjust)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, proto.balanceOperations),
    ).toBeUndefined();
  });

  it('lists the journal with the filters, a bare day read as midnight in Moscow', async () => {
    const { controller, balances } = build();
    const query = plainToInstance(ListMerchantBalanceOperationsQueryDto, {
      from: '2026-10-01',
      type: 'deal_pay_out_escrow,admin_adjustment',
    });

    const page = await controller.balanceOperations(MERCHANT, query);

    expect(balances.listOperations).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      from: new Date('2026-09-30T21:00:00Z'),
      to: undefined,
      types: [
        MerchantBalanceOperationType.DealPayOutEscrow,
        MerchantBalanceOperationType.AdminAdjustment,
      ],
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    });
    expect(page.items).toEqual([
      {
        id: 1,
        createdAt: CREATED,
        type: 'deal_pay_out_escrow',
        amount: '-400.000000',
        balanceBefore: '2400.000000',
        balanceAfter: '2000.000000',
        escrowBefore: '0.000000',
        escrowAfter: '400.000000',
        transactionId: uuidOf(50),
        comment: null,
        actorUserId: null,
      },
    ]);
  });

  it('answers 404 for an unknown merchant', async () => {
    const { controller, balances } = build(false);

    await expect(
      controller.balanceOperations(
        MERCHANT,
        plainToInstance(ListMerchantBalanceOperationsQueryDto, {}),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(balances.listOperations).not.toHaveBeenCalled();
  });

  it('exports CSV with quoting and the strings of the JSON', async () => {
    const { controller, balances } = build();

    const file = await controller.exportBalanceOperations(MERCHANT, {});
    const csv = (file.getStream().read() as Buffer).toString('utf-8');

    expect(balances.exportOperations).toHaveBeenCalledWith(
      {
        merchantId: MERCHANT,
        from: undefined,
        to: undefined,
        types: undefined,
      },
      100000,
    );
    expect(csv).toBe(
      [
        'date,type,amount,balanceBefore,balanceAfter,escrowBefore,escrowAfter,transactionId,comment',
        `2026-10-26T10:00:00.000Z,deal_pay_out_escrow,-400.000000,2400.000000,2000.000000,0.000000,400.000000,${uuidOf(50)},`,
        '2026-10-26T10:00:00.000Z,admin_adjustment,-400.000000,2400.000000,2000.000000,0.000000,400.000000,,"fix, ""by hand"""',
        '',
      ].join('\r\n'),
    );
    expect(file.getHeaders()).toEqual(
      expect.objectContaining({
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="merchant-balance-operations-${MERCHANT}.csv"`,
      }),
    );
  });

  it('adjusts with a typed amount, the comment and the actor', async () => {
    const { controller, balances } = build();

    await controller.adjust(
      MERCHANT,
      { direction: 'debit', amount: '25.5', comment: 'fee' },
      superadmin,
    );

    expect(balances.adjust).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      direction: 'debit',
      amount: toCrypto('25.5'),
      comment: 'fee',
      actorUserId: superadmin.id,
    });
  });

  it('validates an adjustment: a known direction, a positive amount string, a comment', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(AdjustMerchantBalanceDto, body))).map(
        (error) => error.property,
      );

    expect(
      await errors({ direction: 'credit', amount: '1', comment: 'x' }),
    ).toEqual([]);
    expect(
      await errors({ direction: 'up', amount: '0', comment: '  ' }),
    ).toEqual(['direction', 'amount', 'comment']);
    expect(
      await errors({ direction: 'credit', amount: 1, comment: 'x' }),
    ).toEqual(['amount']);
  });
});
