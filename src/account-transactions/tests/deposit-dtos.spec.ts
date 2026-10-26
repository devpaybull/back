import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { toCrypto } from '../../common/utils/to-crypto';
import { CreateDepositRequestDto } from '../dto/create-deposit-request.dto';
import { toDepositRequestDto } from '../dto/deposit-request.dto';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';

const errorsOf = async (amount: unknown): Promise<string[]> =>
  (await validate(plainToInstance(CreateDepositRequestDto, { amount }))).map(
    (error) => error.property,
  );

describe('CreateDepositRequestDto', () => {
  it.each(['500', '0.000001', '1000000000000'])(
    'accepts %p',
    async (amount) => {
      await expect(errorsOf(amount)).resolves.toEqual([]);
    },
  );

  it.each(['0', '0.0000001', '-1', '1e3', '0500', ''])(
    'refuses %p',
    async (amount) => {
      await expect(errorsOf(amount)).resolves.toEqual(['amount']);
    },
  );

  it('refuses a JSON number', async () => {
    await expect(errorsOf(500)).resolves.toEqual(['amount']);
  });
});

describe('toDepositRequestDto', () => {
  const base = {
    id: 40,
    status: AccountTransactionStatus.Completed,
    statusReason: null,
    address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    expiresAt: null,
    createdAt: new Date('2026-10-25T12:00:00.000Z'),
  };

  it('formats both amounts to six decimals', () => {
    expect(
      toDepositRequestDto(
        {
          ...base,
          amount: toCrypto('500.5'),
          creditedAmount: toCrypto('499'),
        } as AccountTransaction,
        'data:image/png;base64,QR',
      ),
    ).toMatchObject({
      amount: '500.500000',
      creditedAmount: '499.000000',
      network: 'TRC20',
      qrCode: 'data:image/png;base64,QR',
    });
  });

  it('answers null amounts for a deposit without a request, not yet credited', () => {
    expect(
      toDepositRequestDto(
        {
          ...base,
          status: AccountTransactionStatus.Processing,
          statusReason: AccountTransactionStatusReason.BelowMinimum,
          amount: null,
          creditedAmount: null,
        } as AccountTransaction,
        'qr',
      ),
    ).toMatchObject({
      amount: null,
      creditedAmount: null,
      statusReason: AccountTransactionStatusReason.BelowMinimum,
    });
  });
});
