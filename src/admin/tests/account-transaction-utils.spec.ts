import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';
import { accountTransactionsCsv } from '../utils/account-transactions-csv';
import { assertMayActOnAccount } from '../utils/assert-may-act-on-account';
import { csvField } from '../utils/csv-field';
import { toAccountTransactionListQuery } from '../utils/to-account-transaction-list-query';
import { toAccountTransactionParties } from '../utils/to-account-transaction-parties';
import { toHashVerificationDto } from '../utils/to-hash-verification-dto';

const admin: AuthenticatedUser = {
  id: uuidOf(9),
  login: 'admin',
  role: Role.Admin,
  status: UserStatus.Active,
};

describe('csvField', () => {
  it('writes a plain value as it is and null as empty', () => {
    expect(csvField('abc')).toBe('abc');
    expect(csvField(41)).toBe('41');
    expect(csvField(null)).toBe('');
  });

  it('quotes a comma, a quote or a line break, doubling quotes', () => {
    expect(csvField('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it.each(['=SUM(A1)', '+1+1', '-cmd', '@me', '\tx'])(
    'neutralises a spreadsheet formula in %p with a leading apostrophe',
    (value) => {
      expect(csvField(value)).toBe(`'${value}`);
    },
  );

  it('leaves a signed amount alone', () => {
    expect(csvField('-12.500000')).toBe('-12.500000');
    expect(csvField('-3')).toBe('-3');
  });
});

describe('accountTransactionsCsv', () => {
  it('is only the header for no rows, with CRLF', () => {
    expect(accountTransactionsCsv([])).toBe(
      'id,status,statusReason,user,address,amount,fee,txHash,createdAt,completedAt\r\n',
    );
  });

  it('writes ISO dates and empty fields for nulls', () => {
    const csv = accountTransactionsCsv([
      {
        id: 1,
        status: 'pending',
        statusReason: null,
        login: 'a,b',
        address: null,
        amount: '1.000000',
        fee: null,
        txHash: null,
        createdAt: new Date('2026-10-25T00:00:00Z'),
        completedAt: null,
      },
    ]);

    expect(csv.split('\r\n')[1]).toBe(
      '1,pending,,"a,b",,1.000000,,,2026-10-25T00:00:00.000Z,',
    );
  });
});

describe('toAccountTransactionParties', () => {
  it('maps users by id with the login rule', () => {
    const parties = toAccountTransactionParties([
      { id: uuidOf(1), telegramUsername: 'durov', email: 'd@x.io' } as User,
      {
        id: uuidOf(2),
        telegramUsername: null,
        email: 'e@x.io',
      } as unknown as User,
    ]);

    expect(parties.get(uuidOf(1))).toEqual({
      id: uuidOf(1),
      login: 'durov',
      telegramUsername: 'durov',
    });
    expect(parties.get(uuidOf(2))).toEqual({
      id: uuidOf(2),
      login: 'e@x.io',
      telegramUsername: null,
    });
  });
});

describe('toHashVerificationDto', () => {
  it('formats the amounts of the inspected transfers', () => {
    expect(
      toHashVerificationDto(
        {
          status: 'confirmed',
          transfers: [
            {
              txHash: 'h',
              logIndex: 2,
              from: 'TA',
              to: 'TB',
              amount: toCrypto('1.5'),
              blockNumber: 3,
              blockTime: new Date(0),
            },
          ],
        },
        false,
        '1.500000',
        'Only a deposit that needs a check can be credited by hand',
      ),
    ).toEqual({
      status: 'confirmed',
      transfers: [
        {
          txHash: 'h',
          logIndex: 2,
          from: 'TA',
          to: 'TB',
          amount: '1.500000',
          blockNumber: 3,
          blockTime: new Date(0),
        },
      ],
      acceptable: false,
      amount: '1.500000',
      reason: 'Only a deposit that needs a check can be credited by hand',
    });
  });
});

describe('assertMayActOnAccount', () => {
  it('404 for nobody', () => {
    expect(() => assertMayActOnAccount(admin, null)).toThrow(NotFoundException);
  });

  it('403 for the admin’s own account', () => {
    expect(() =>
      assertMayActOnAccount(admin, { id: admin.id, role: Role.Admin } as User),
    ).toThrow(ForbiddenException);
  });

  it.each([Role.Admin, Role.Superadmin])(
    '403 for an admin acting on a %s',
    (role) => {
      expect(() =>
        assertMayActOnAccount(admin, { id: uuidOf(1), role } as User),
      ).toThrow(ForbiddenException);
    },
  );

  it.each([Role.Trader, Role.LeadTrader])(
    'lets an admin act on a %s',
    (role) => {
      expect(() =>
        assertMayActOnAccount(admin, { id: uuidOf(1), role } as User),
      ).not.toThrow();
    },
  );

  it('lets a superadmin act on an admin', () => {
    expect(() =>
      assertMayActOnAccount({ ...admin, role: Role.Superadmin }, {
        id: uuidOf(1),
        role: Role.Admin,
      } as User),
    ).not.toThrow();
  });
});

describe('toAccountTransactionListQuery', () => {
  const build = () => ({
    directory: {
      findIdsMatching: jest.fn(async () => [uuidOf(1)]),
      rankByLogin: jest.fn(async () => new Map([[uuidOf(1), 0]])),
    },
    operations: { userIdsOf: jest.fn(async () => [uuidOf(1)]) },
  });
  const dto = (overrides: Partial<ListAccountTransactionsQueryDto> = {}) =>
    Object.assign(new ListAccountTransactionsQueryDto(), {
      page: 2,
      limit: 10,
      ...overrides,
    });

  it('copies the filters and fixes the type', async () => {
    const { directory, operations } = build();
    const createdFrom = new Date(0);

    const query = await toAccountTransactionListQuery(
      AccountTransactionType.Withdrawal,
      dto({ createdFrom, userId: uuidOf(3) }),
      directory as never,
      operations as never,
    );

    expect(query).toMatchObject({
      type: AccountTransactionType.Withdrawal,
      page: 2,
      limit: 10,
      createdFrom,
      userId: uuidOf(3),
      matchedUserIds: undefined,
    });
    expect(directory.findIdsMatching).not.toHaveBeenCalled();
    expect(operations.userIdsOf).not.toHaveBeenCalled();
  });

  it('matches logins for a text term, trimmed, and not for digits', async () => {
    const { directory, operations } = build();

    const text = await toAccountTransactionListQuery(
      AccountTransactionType.Deposit,
      dto({ search: ' durov ' }),
      directory as never,
      operations as never,
    );
    const digits = await toAccountTransactionListQuery(
      AccountTransactionType.Deposit,
      dto({ search: '41' }),
      directory as never,
      operations as never,
    );

    expect(directory.findIdsMatching).toHaveBeenCalledTimes(1);
    expect(directory.findIdsMatching).toHaveBeenCalledWith('durov');
    expect(text).toMatchObject({
      search: 'durov',
      matchedUserIds: [uuidOf(1)],
    });
    expect(digits).toMatchObject({ search: '41', matchedUserIds: undefined });
  });

  it('ranks the filtered accounts for sortBy=user', async () => {
    const { directory, operations } = build();

    const query = await toAccountTransactionListQuery(
      AccountTransactionType.Deposit,
      dto({ sortBy: AccountTransactionSortField.User }),
      directory as never,
      operations as never,
    );

    expect(operations.userIdsOf).toHaveBeenCalledWith(
      expect.objectContaining({ type: AccountTransactionType.Deposit }),
    );
    expect(directory.rankByLogin).toHaveBeenCalledWith([uuidOf(1)]);
    expect(query.userRanks).toEqual(new Map([[uuidOf(1), 0]]));
  });
});
