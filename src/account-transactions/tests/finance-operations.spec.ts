import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { UserStatus } from '../../users/types/user-status.enum';
import { FinanceOperationsController } from '../controllers/finance-operations.controller';
import { FinanceHistoryFilterDto } from '../dto/finance-history-filter.dto';
import { toFinanceOperationDto } from '../dto/finance-operation.dto';
import { ListFinanceOperationsQueryDto } from '../dto/list-finance-operations-query.dto';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

const ME = uuidOf(1);
const OTHER = uuidOf(2);

const row = (overrides: Partial<AccountTransaction> = {}): AccountTransaction =>
  ({
    id: 1,
    type: AccountTransactionType.Deposit,
    status: AccountTransactionStatus.Completed,
    statusReason: null,
    userId: ME,
    counterpartyUserId: null,
    address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    amount: toCrypto(500),
    creditedAmount: null,
    fee: null,
    txHash: 'a'.repeat(64),
    expiresAt: null,
    createdAt: new Date('2026-10-25T12:00:00.000Z'),
    completedAt: null,
    ...overrides,
  }) as AccountTransaction;

describe('toFinanceOperationDto', () => {
  it('reads a deposit as incoming and prefers the credited amount', () => {
    expect(
      toFinanceOperationDto(row({ creditedAmount: toCrypto('499.5') }), ME),
    ).toMatchObject({ direction: 'in', amount: '499.500000', fee: null });
  });

  it('falls back to the requested amount before the deposit is credited', () => {
    expect(toFinanceOperationDto(row(), ME).amount).toBe('500.000000');
  });

  it('answers a null amount for a deposit with neither', () => {
    expect(toFinanceOperationDto(row({ amount: null }), ME).amount).toBeNull();
  });

  it('reads a withdrawal as outgoing with its fee', () => {
    expect(
      toFinanceOperationDto(
        row({
          type: AccountTransactionType.Withdrawal,
          fee: toCrypto('0.2883'),
        }),
        ME,
      ),
    ).toMatchObject({ direction: 'out', fee: '0.288300' });
  });

  it('reads a transfer by the side the viewer is on', () => {
    const transfer = row({
      type: AccountTransactionType.Transfer,
      userId: OTHER,
      counterpartyUserId: ME,
      address: null,
    });

    expect(toFinanceOperationDto(transfer, ME).direction).toBe('in');
    expect(toFinanceOperationDto(transfer, OTHER).direction).toBe('out');
  });
});

describe('ListFinanceOperationsQueryDto', () => {
  const parse = async (input: Record<string, unknown>) => {
    const dto = plainToInstance(ListFinanceOperationsQueryDto, input);

    return {
      dto,
      errors: (await validate(dto)).map((error) => error.property),
    };
  };

  it('reads type and status lists, repeated or comma-separated', async () => {
    const { dto, errors } = await parse({
      type: 'deposit,withdrawal',
      status: ['pending', 'completed'],
    });

    expect(errors).toEqual([]);
    expect(dto.type).toEqual(['deposit', 'withdrawal']);
    expect(dto.status).toEqual(['pending', 'completed']);
    expect(dto.sortBy).toBe('createdAt');
  });

  it('reads the period as dates', async () => {
    const { dto, errors } = await parse({
      from: '2026-10-01T00:00:00Z',
      to: '2026-11-01',
    });

    expect(errors).toEqual([]);
    expect(dto.from).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(dto.to).toBeInstanceOf(Date);
  });

  it.each([
    [{ type: 'deal' }, 'type'],
    [{ status: 'done' }, 'status'],
    [{ sortBy: 'fee' }, 'sortBy'],
    [{ from: 'yesterday' }, 'from'],
  ])('refuses %p', async (input, property) => {
    await expect(parse(input)).resolves.toMatchObject({ errors: [property] });
  });

  it('accepts amount as a sort', async () => {
    await expect(parse({ sortBy: 'amount' })).resolves.toMatchObject({
      errors: [],
    });
  });

  it('the stats filter reads a status list and a period too', async () => {
    const dto = plainToInstance(FinanceHistoryFilterDto, {
      status: 'failed,canceled',
      from: '2026-10-01',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.status).toEqual(['failed', 'canceled']);
  });
});

describe('FinanceOperationsController', () => {
  const user: AuthenticatedUser = {
    id: ME,
    login: 'trader',
    role: Role.Trader,
    status: UserStatus.Suspended,
  };

  const build = () => {
    const operations = {
      history: jest.fn(
        async () =>
          new Page([row()], { total: 1, page: 1, limit: 20, pages: 1 }),
      ),
      historyCounts: jest.fn(async () => ({
        deposit: 3,
        withdrawal: 2,
        transfer: 1,
      })),
    };

    return {
      controller: new FinanceOperationsController(operations as never),
      operations,
    };
  };

  it('is for traders and lead traders, and is read-only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, FinanceOperationsController),
    ).toEqual([Role.Trader, Role.LeadTrader]);
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        FinanceOperationsController.prototype.list,
      ),
    ).toBeUndefined();
  });

  it('lists the caller’s own operations with the filters it was given', async () => {
    const { controller, operations } = build();
    const query = plainToInstance(ListFinanceOperationsQueryDto, {
      page: '1',
      limit: '20',
      type: 'deposit',
    });

    const page = await controller.list(query, user);

    expect(operations.history).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ME,
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        type: ['deposit'],
      }),
    );
    expect(page.items[0]).toMatchObject({ id: 1, direction: 'in' });
  });

  it('answers the tab counts with their sum', async () => {
    const { controller, operations } = build();

    await expect(controller.stats({}, user)).resolves.toEqual({
      all: 6,
      deposit: 3,
      withdrawal: 2,
      transfer: 1,
    });
    expect(operations.historyCounts).toHaveBeenCalledWith({
      userId: ME,
      status: undefined,
      from: undefined,
      to: undefined,
    });
  });
});
