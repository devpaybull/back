import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreatePayOutDto } from '../dto/create-pay-out.dto';

const CARD = '4111111111111111';

const body = (overrides: Record<string, unknown> = {}) => ({
  method: 'card',
  amount: '5000',
  merchantTransactionId: 'payout-1',
  requisite: { ownerName: 'PETR PETROV', bank: 'tbank', cardNumber: CARD },
  ...overrides,
});

const flatten = (errors: ValidationError[], parent?: string): string[] =>
  errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.keys(error.constraints ?? {}).map(
      (code) => `${field}:${code}`,
    );

    return [...own, ...flatten(error.children ?? [], field)];
  });

const errorsOf = async (plain: Record<string, unknown>) =>
  flatten(
    await validate(plainToInstance(CreatePayOutDto, plain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  ).sort();

describe('CreatePayOutDto', () => {
  it('accepts a card pay-out, an sbp one and the full body', async () => {
    expect(await errorsOf(body())).toEqual([]);
    expect(
      await errorsOf(
        body({
          method: 'sbp',
          requisite: {
            ownerName: 'P',
            bank: 'tbank',
            sbpNumber: '79001234567',
          },
        }),
      ),
    ).toEqual([]);
    expect(
      await errorsOf(
        body({
          amount: '5000.50',
          currency: 'RUB',
          callbackUrl: 'https://merchant.example/cb',
          timeoutInMin: 120,
          payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ['card without cardNumber', 'card', { sbpNumber: '79001234567' }],
    [
      'card with both numbers',
      'card',
      { cardNumber: CARD, sbpNumber: '79001234567' },
    ],
    ['sbp without sbpNumber', 'sbp', { cardNumber: CARD }],
    [
      'sbp with both numbers',
      'sbp',
      { cardNumber: CARD, sbpNumber: '79001234567' },
    ],
    ['card with neither', 'card', {}],
  ])('refuses %s', async (_case, method, numbers) => {
    expect(
      await errorsOf(
        body({
          method,
          requisite: { ownerName: 'P', bank: 'tbank', ...numbers },
        }),
      ),
    ).toEqual(['requisite:matchesMethod']);
  });

  it('leaves a method that does not pay out to the service, so it answers METHOD_NOT_SUPPORTED', async () => {
    expect(await errorsOf(body({ method: 'counterparty' }))).toEqual([]);
  });

  it.each([
    ['a failed Luhn check', '4111111111111112', ['luhn']],
    ['12 digits', '411111111111', ['luhn', 'matches']],
    ['20 digits', '41111111111111111111', ['luhn', 'matches']],
    ['spaces', '4111 1111 1111 1111', ['luhn', 'matches']],
  ])('refuses a card number with %s', async (_case, cardNumber, codes) => {
    const errors = await errorsOf(
      body({ requisite: { ownerName: 'P', bank: 'tbank', cardNumber } }),
    );

    expect(errors).toEqual(codes.map((code) => `requisite.cardNumber:${code}`));
  });

  it('accepts 13- and 19-digit numbers that pass Luhn', async () => {
    for (const cardNumber of [
      '4222222222222',
      '6011000990139424',
      '2200000000000000004',
    ]) {
      expect(
        await errorsOf(
          body({ requisite: { ownerName: 'P', bank: 'tbank', cardNumber } }),
        ),
      ).toEqual([]);
    }
  });

  it.each([
    '+79001234567',
    '89001234567x',
    '0123456789',
    '7900',
    '7900123456789012',
  ])('refuses the sbp number %s', async (sbpNumber) => {
    expect(
      await errorsOf(
        body({
          method: 'sbp',
          requisite: { ownerName: 'P', bank: 'tbank', sbpNumber },
        }),
      ),
    ).toEqual(['requisite.sbpNumber:matches']);
  });

  it('refuses an empty or over-long owner name and a missing bank', async () => {
    expect(
      await errorsOf(
        body({ requisite: { ownerName: '', bank: 'tbank', cardNumber: CARD } }),
      ),
    ).toEqual(['requisite.ownerName:isLength']);
    expect(
      await errorsOf(
        body({
          requisite: {
            ownerName: 'x'.repeat(256),
            bank: 'tbank',
            cardNumber: CARD,
          },
        }),
      ),
    ).toEqual(['requisite.ownerName:isLength']);
    expect(
      await errorsOf(body({ requisite: { ownerName: 'P', cardNumber: CARD } })),
    ).toEqual(['requisite.bank:isString', 'requisite.bank:maxLength'].sort());
  });

  it('refuses a missing requisite and an unknown field inside it', async () => {
    expect(await errorsOf(body({ requisite: undefined }))).toEqual([
      'requisite:isDefined',
      'requisite:isObject',
    ]);
    expect(
      await errorsOf(
        body({
          requisite: {
            ownerName: 'P',
            bank: 'tbank',
            cardNumber: CARD,
            cvv: '1',
          },
        }),
      ),
    ).toEqual(['requisite.cvv:whitelistValidation']);
  });

  it.each([0, 121, 1.5, '30'])(
    'refuses timeoutInMin %p',
    async (timeoutInMin) => {
      expect(
        (await errorsOf(body({ timeoutInMin }))).every((error) =>
          error.startsWith('timeoutInMin:'),
        ),
      ).toBe(true);
      expect(await errorsOf(body({ timeoutInMin }))).not.toEqual([]);
    },
  );

  it('refuses a zero amount, a third decimal and an unknown top-level field', async () => {
    expect(await errorsOf(body({ amount: '0' }))).toHaveLength(1);
    expect(await errorsOf(body({ amount: '1.005' }))).toHaveLength(1);
    expect(await errorsOf(body({ successUrl: 'https://x.example' }))).toEqual([
      'successUrl:whitelistValidation',
    ]);
  });

  it('takes payerInfo as optional, with userId required inside it', async () => {
    expect(await errorsOf(body({ payerInfo: {} }))).toEqual([
      'payerInfo.userId:isLength',
      'payerInfo.userId:isString',
    ]);
  });
});
