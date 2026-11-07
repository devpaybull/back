import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePayInDto } from '../dto/create-pay-in.dto';

const body = (overrides: Record<string, unknown> = {}) => ({
  method: 'sbp',
  amount: '2000',
  merchantTransactionId: 'order-1.A:b_c-2',
  payerInfo: { userId: 'client-1' },
  ...overrides,
});

const errorsOf = async (plain: Record<string, unknown>) =>
  (
    await validate(plainToInstance(CreatePayInDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((error) => error.property);

describe('CreatePayInDto', () => {
  it('accepts the minimal body and the full one', async () => {
    expect(await errorsOf(body())).toEqual([]);
    expect(
      await errorsOf(
        body({
          amount: '2000.50',
          currency: 'RUB',
          bank: 'tbank',
          payerBank: 'sber',
          operator: 'mts',
          callbackUrl: 'https://merchant.example/cb',
          successUrl: 'https://merchant.example/ok',
          errorUrl: 'https://merchant.example/err',
          payerInfo: {
            userId: 'client-1',
            ip: '2001:db8::1',
            userAgent: 'Mozilla/5.0',
            fingerprint: 'fp',
            registeredAt: '1730700000000',
          },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['a third decimal', '2000.505'],
    ['zero', '0'],
    ['an exponent', '1e3'],
    ['a sign', '-5'],
    ['a JSON number that reached the DTO as a number', 2000],
  ])('refuses an amount with %s', async (_case, amount) => {
    expect(await errorsOf(body({ amount }))).toEqual(['amount']);
  });

  it('refuses a missing payerInfo, a payerInfo without userId and an over-long userId', async () => {
    expect(await errorsOf(body({ payerInfo: undefined }))).toEqual([
      'payerInfo',
    ]);
    expect(await errorsOf(body({ payerInfo: {} }))).toEqual(['payerInfo']);
    expect(
      await errorsOf(body({ payerInfo: { userId: 'x'.repeat(256) } })),
    ).toEqual(['payerInfo']);
  });

  it.each([
    ['ip', 'not-an-ip'],
    ['userAgent', 'x'.repeat(1025)],
    ['registeredAt', 'yesterday'],
    ['registeredAt', '2026-11-04T10:00'],
  ])('refuses payerInfo.%s = %s', async (field, value) => {
    expect(
      await errorsOf(body({ payerInfo: { userId: 'c', [field]: value } })),
    ).toEqual(['payerInfo']);
  });

  it('takes registeredAt as an ISO instant with a zone', async () => {
    expect(
      await errorsOf(
        body({
          payerInfo: { userId: 'c', registeredAt: '2026-11-04T10:00:00+03:00' },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a merchantTransactionId outside [A-Za-z0-9._:-]{1,255}', async () => {
    for (const merchantTransactionId of ['', 'with space', 'x'.repeat(256)]) {
      expect(await errorsOf(body({ merchantTransactionId }))).toEqual([
        'merchantTransactionId',
      ]);
    }
  });

  it('refuses a URL that is not https', async () => {
    expect(
      await errorsOf(body({ callbackUrl: 'http://merchant.example/cb' })),
    ).toEqual(['callbackUrl']);
  });

  it('refuses counteragent and any other unknown field (Q-MA03.2, Q-MA03.8)', async () => {
    expect(await errorsOf(body({ counteragent: true }))).toEqual([
      'counteragent',
    ]);
  });
});
