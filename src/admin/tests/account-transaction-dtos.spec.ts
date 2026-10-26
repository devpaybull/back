import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { DepositTransfer } from '../../account-transactions/entities/deposit-transfer.entity';
import { WithdrawalAttempt } from '../../account-transactions/entities/withdrawal-attempt.entity';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { AccountTransactionPartyDto } from '../dto/account-transaction-party.dto';
import { toAdminDepositDto } from '../dto/admin-deposit.dto';
import { toAdminWithdrawalDto } from '../dto/admin-withdrawal.dto';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';
import { RejectWithdrawalDto } from '../dto/reject-withdrawal.dto';
import { TxHashDto } from '../dto/tx-hash.dto';

const parse = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) => {
  const dto = plainToInstance(cls, plain);

  return { dto, errors: await validate(dto) };
};

const TRADER = uuidOf(1);
const ADMIN = uuidOf(9);
const parties = new Map<string, AccountTransactionPartyDto>([
  [TRADER, { id: TRADER, login: 'durov', telegramUsername: 'durov' }],
  [ADMIN, { id: ADMIN, login: 'admin', telegramUsername: 'admin' }],
]);

describe('TxHashDto', () => {
  it('trims and lower-cases a hash', async () => {
    const { dto, errors } = await parse(TxHashDto, {
      txHash: `  ${'AB'.repeat(32)} `,
    });

    expect(errors).toEqual([]);
    expect(dto.txHash).toBe('ab'.repeat(32));
  });

  it.each([
    'a'.repeat(63),
    'a'.repeat(65),
    'g'.repeat(64),
    `0x${'a'.repeat(62)}`,
    123,
  ])('refuses %p', async (txHash) => {
    const { errors } = await parse(TxHashDto, { txHash });

    expect(errors.map((error) => error.property)).toEqual(['txHash']);
  });
});

describe('RejectWithdrawalDto', () => {
  it('trims the reason', async () => {
    const { dto, errors } = await parse(RejectWithdrawalDto, {
      reason: '  Suspicious  ',
    });

    expect(errors).toEqual([]);
    expect(dto.reason).toBe('Suspicious');
  });

  it.each(['', '   ', 'x'.repeat(501), 5])('refuses %p', async (reason) => {
    const { errors } = await parse(RejectWithdrawalDto, { reason });

    expect(errors.map((error) => error.property)).toEqual(['reason']);
  });

  it('accepts 500 characters', async () => {
    const { errors } = await parse(RejectWithdrawalDto, {
      reason: 'x'.repeat(500),
    });

    expect(errors).toEqual([]);
  });
});

describe('ListAccountTransactionsQueryDto', () => {
  it('defaults to the newest first by creation', async () => {
    const { dto, errors } = await parse(ListAccountTransactionsQueryDto, {});

    expect(errors).toEqual([]);
    expect(dto.sortBy).toBe(AccountTransactionSortField.CreatedAt);
  });

  it('reads a status list, repeated or comma-separated', async () => {
    const { dto, errors } = await parse(ListAccountTransactionsQueryDto, {
      status: ['pending,processing', 'failed'],
    });

    expect(errors).toEqual([]);
    expect(dto.status).toEqual(['pending', 'processing', 'failed']);
  });

  it.each([
    ['status', { status: 'lost' }],
    ['statusReason', { statusReason: 'whatever' }],
    ['userId', { userId: 'not-a-uuid' }],
    ['sortBy', { sortBy: 'login' }],
    [
      'createdTo',
      {
        createdFrom: '2026-10-25T00:00:00Z',
        createdTo: '2026-10-24T00:00:00Z',
      },
    ],
  ])('refuses a bad %s', async (property, plain) => {
    const { errors } = await parse(ListAccountTransactionsQueryDto, plain);

    expect(errors.map((error) => error.property)).toEqual([property]);
  });

  it.each(Object.values(AccountTransactionSortField))(
    'sorts by %s',
    async (sortBy) => {
      const { errors } = await parse(ListAccountTransactionsQueryDto, {
        sortBy,
      });

      expect(errors).toEqual([]);
    },
  );
});

describe('toAdminDepositDto', () => {
  const deposit = (status: AccountTransactionStatus): AccountTransaction =>
    ({
      id: 41,
      type: AccountTransactionType.Deposit,
      status,
      statusReason: null,
      userId: TRADER,
      amount: null,
      amountReceived: toCrypto(5),
      creditedAmount: null,
      address: 'TDeposit',
      expiresAt: null,
      actorUserId: null,
      createdAt: new Date(0),
      completedAt: null,
    }) as AccountTransaction;

  it('renders the row with its transfers, no AML and the window', () => {
    expect(
      toAdminDepositDto(
        deposit(AccountTransactionStatus.Processing),
        [
          {
            txHash: 'h',
            amount: toCrypto(5),
            fromAddress: 'TFrom',
          } as DepositTransfer,
        ],
        parties,
        45,
      ),
    ).toEqual({
      id: 41,
      status: AccountTransactionStatus.Processing,
      statusReason: null,
      user: parties.get(TRADER),
      amount: null,
      amountReceived: '5.000000',
      creditedAmount: null,
      address: 'TDeposit',
      windowMinutes: 45,
      expiresAt: null,
      transfers: [{ txHash: 'h', amount: '5.000000', fromAddress: 'TFrom' }],
      aml: null,
      createdAt: new Date(0),
      completedAt: null,
      actor: null,
      actions: { canCredit: false },
    });
  });

  it.each(Object.values(AccountTransactionStatus))(
    'offers «Зачислить» for %s only when failed',
    (status) => {
      expect(
        toAdminDepositDto(deposit(status), [], parties, 45).actions.canCredit,
      ).toBe(status === AccountTransactionStatus.Failed);
    },
  );
});

describe('toAdminWithdrawalDto', () => {
  const withdrawal = (status: AccountTransactionStatus): AccountTransaction =>
    ({
      id: 41,
      status,
      statusReason: null,
      userId: TRADER,
      amount: toCrypto(100),
      fee: toCrypto('0.2883'),
      address: 'TDest',
      txHash: null,
      comment: null,
      paidManually: null,
      actorUserId: ADMIN,
      createdAt: new Date(0),
      completedAt: null,
    }) as AccountTransaction;

  it('renders the amounts, the attempts and the acting admin', () => {
    expect(
      toAdminWithdrawalDto(
        withdrawal(AccountTransactionStatus.Pending),
        [
          {
            txHash: 'h',
            status: OutgoingTransferStatus.Expired,
          } as WithdrawalAttempt,
        ],
        parties,
        [AccountTransactionStatus.Failed],
      ),
    ).toMatchObject({
      amount: '100.000000',
      fee: '0.288300',
      paidManually: false,
      attempts: [{ txHash: 'h', status: OutgoingTransferStatus.Expired }],
      actor: parties.get(ADMIN),
    });
  });

  it.each(Object.values(AccountTransactionStatus))(
    'in auto mode offers «Вывести» only for failed and reject for pending or failed (%s)',
    (status) => {
      expect(
        toAdminWithdrawalDto(withdrawal(status), [], parties, [
          AccountTransactionStatus.Failed,
        ]).actions,
      ).toEqual({
        canPayManually: status === AccountTransactionStatus.Failed,
        canReject:
          status === AccountTransactionStatus.Pending ||
          status === AccountTransactionStatus.Failed,
      });
    },
  );

  it('in manual mode offers «Вывести» for pending too', () => {
    expect(
      toAdminWithdrawalDto(
        withdrawal(AccountTransactionStatus.Pending),
        [],
        parties,
        [AccountTransactionStatus.Pending, AccountTransactionStatus.Failed],
      ).actions.canPayManually,
    ).toBe(true);
  });
});
