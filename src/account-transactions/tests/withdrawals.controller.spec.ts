import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { UserStatus } from '../../users/types/user-status.enum';
import { WithdrawalsController } from '../controllers/withdrawals.controller';
import { CreateWithdrawalDto } from '../dto/create-withdrawal.dto';
import { WithdrawalQuoteQueryDto } from '../dto/withdrawal-quote-query.dto';
import { toWithdrawalQuoteDto } from '../dto/withdrawal-quote.dto';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

const EXTERNAL = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
};

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const body = (metatype: new () => object, value: object) =>
  pipe.transform(value, { type: 'body', metatype });

const row = (overrides: Partial<AccountTransaction> = {}): AccountTransaction =>
  ({
    id: 41,
    type: AccountTransactionType.Withdrawal,
    status: AccountTransactionStatus.Pending,
    statusReason: null,
    userId: trader.id,
    counterpartyUserId: null,
    amount: toCrypto(100),
    creditedAmount: null,
    fee: toCrypto('0.5'),
    address: EXTERNAL,
    txHash: null,
    expiresAt: null,
    createdAt: new Date('2026-10-25T00:00:00Z'),
    completedAt: null,
    ...overrides,
  }) as AccountTransaction;

describe('WithdrawalsController', () => {
  const build = () => {
    const withdrawals = {
      quote: jest.fn(async () => ({
        available: toCrypto(200),
        fee: { usdt: toCrypto('0.5'), trx: toCrypto('1.5') },
        maxAmount: toCrypto('199.5'),
        internal: false,
        expiresAt: new Date('2026-10-25T00:01:00Z'),
      })),
      request: jest.fn(async () => row()),
      findOwn: jest.fn(async () => row()),
      cancelOwn: jest.fn(async () =>
        row({ status: AccountTransactionStatus.Canceled }),
      ),
    };

    return {
      withdrawals,
      controller: new WithdrawalsController(withdrawals as never),
    };
  };

  it('is for traders and lead traders only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, WithdrawalsController),
    ).toEqual([Role.Trader, Role.LeadTrader]);
  });

  it('marks quote (it stores a quote), create and cancel as writes, and nothing else', () => {
    const marked = (handler: keyof WithdrawalsController) =>
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        WithdrawalsController.prototype[handler],
      ) === true;

    expect(marked('create')).toBe(true);
    expect(marked('cancel')).toBe(true);
    expect(marked('quote')).toBe(true);
    expect(marked('findOne')).toBe(false);
  });

  it('quotes with the decimal amount and maps the answer to strings', async () => {
    const { controller, withdrawals } = build();

    const quote = await controller.quote(
      { address: EXTERNAL, amount: '100.5' },
      trader,
    );

    expect(withdrawals.quote).toHaveBeenCalledWith(
      trader.id,
      EXTERNAL,
      toCrypto('100.5'),
    );
    expect(quote).toEqual({
      available: '200.000000',
      fee: { usdt: '0.500000', trx: '1.500000' },
      maxAmount: '199.500000',
      internal: false,
      expiresAt: new Date('2026-10-25T00:01:00Z'),
    });
  });

  it('requests the withdrawal for the caller and answers the trader’s view', async () => {
    const { controller, withdrawals } = build();

    const result = await controller.create(
      { address: EXTERNAL, amount: '100', totp: '123456' },
      trader,
    );

    expect(withdrawals.request).toHaveBeenCalledWith({
      userId: trader.id,
      address: EXTERNAL,
      amount: toCrypto(100),
      totp: '123456',
    });
    expect(result).toMatchObject({
      id: 41,
      type: AccountTransactionType.Withdrawal,
      direction: 'out',
      amount: '100.000000',
      fee: '0.500000',
    });
  });

  it('reads and cancels only through the owner-scoped calls', async () => {
    const { controller, withdrawals } = build();

    await controller.findOne(41, trader);
    const canceled = await controller.cancel(41, trader);

    expect(withdrawals.findOwn).toHaveBeenCalledWith(41, trader.id);
    expect(withdrawals.cancelOwn).toHaveBeenCalledWith(41, trader.id);
    expect(canceled.status).toBe(AccountTransactionStatus.Canceled);
  });
});

describe('CreateWithdrawalDto', () => {
  const valid = { amount: '100.123456', address: EXTERNAL, totp: '123456' };

  it('accepts a decimal string, an address and a six-digit code', async () => {
    await expect(body(CreateWithdrawalDto, valid)).resolves.toMatchObject(
      valid,
    );
  });

  it.each([
    ['a JSON number', { amount: 100 }],
    ['seven decimals', { amount: '1.1234567' }],
    ['zero', { amount: '0' }],
    ['a negative amount', { amount: '-1' }],
    ['a five-digit code', { totp: '12345' }],
    ['a code with letters', { totp: '12345a' }],
    ['an address over 64 characters', { address: 'T'.repeat(65) }],
    ['no address', { address: undefined }],
  ])('refuses %s', async (_label, change) => {
    await expect(
      body(CreateWithdrawalDto, { ...valid, ...change }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['confirmed', 'backupCode', 'fee'])(
    'refuses the unknown field %s',
    async (field) => {
      await expect(
        body(CreateWithdrawalDto, { ...valid, [field]: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

describe('WithdrawalQuoteQueryDto', () => {
  const query = (value: object) =>
    pipe.transform(value, { type: 'query', metatype: WithdrawalQuoteQueryDto });

  it('accepts an address and a positive decimal string', async () => {
    await expect(
      query({ address: EXTERNAL, amount: '5' }),
    ).resolves.toMatchObject({ address: EXTERNAL, amount: '5' });
  });

  it.each([
    { address: EXTERNAL },
    { amount: '5' },
    { address: EXTERNAL, amount: '0' },
  ])('refuses %p', async (value) => {
    await expect(query(value)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('toWithdrawalQuoteDto', () => {
  it('renders every amount with six decimals', () => {
    expect(
      toWithdrawalQuoteDto({
        available: toCrypto('0.1'),
        fee: { usdt: toCrypto(0), trx: toCrypto(0) },
        maxAmount: toCrypto('0.1'),
        internal: true,
        expiresAt: new Date(0),
      }),
    ).toEqual({
      available: '0.100000',
      fee: { usdt: '0.000000', trx: '0.000000' },
      maxAmount: '0.100000',
      internal: true,
      expiresAt: new Date(0),
    });
  });
});
