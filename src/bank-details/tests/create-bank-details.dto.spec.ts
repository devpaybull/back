import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { CreateBankDetailsDto } from '../dto/create-bank-details.dto';

const body = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  bankId: 1,
  type: TransactionType.Card,
  card: '4400430212345678',
  ...overrides,
});

const parse = (given: Record<string, unknown>): CreateBankDetailsDto =>
  plainToInstance(CreateBankDetailsDto, given);

const failedProperties = (given: Record<string, unknown>): string[] =>
  validateSync(parse(given)).map((error) => error.property);

describe('CreateBankDetailsDto', () => {
  it('accepts the smallest complete set of details', () => {
    expect(failedProperties(body())).toEqual([]);
  });

  it.each(['bankId', 'type'])('requires %s', (field) => {
    expect(failedProperties(body({ [field]: undefined }))).toEqual([field]);
  });

  it.each(Object.values(TransactionType))('accepts the type %s', (type) => {
    expect(failedProperties(body({ type }))).toEqual([]);
  });

  it('refuses a type outside the enum', () => {
    expect(failedProperties(body({ type: 'p2p' }))).toEqual(['type']);
  });

  describe('card', () => {
    it('keeps a 16-digit number whole, leading zeros and all', () => {
      expect(parse(body({ card: '0000430212345678' })).card).toBe(
        '0000430212345678',
      );
    });

    it('takes a 19-digit number, which no integer column could hold', () => {
      expect(failedProperties(body({ card: '4400430212345678901' }))).toEqual(
        [],
      );
    });

    it('trims what was pasted', () => {
      expect(parse(body({ card: '  4400430212345678  ' })).card).toBe(
        '4400430212345678',
      );
    });

    it('refuses spaces and dashes inside the number', () => {
      expect(failedProperties(body({ card: '4400 4302 1234 5678' }))).toEqual([
        'card',
      ]);
      expect(failedProperties(body({ card: '4400-4302' }))).toEqual(['card']);
    });

    it('refuses letters', () => {
      expect(failedProperties(body({ card: '44004302abcd' }))).toEqual([
        'card',
      ]);
    });
  });

  describe('phone', () => {
    it('keeps the leading plus', () => {
      expect(
        failedProperties(body({ card: undefined, phone: '+79991234567' })),
      ).toEqual([]);
      expect(parse(body({ phone: '+79991234567' })).phone).toBe('+79991234567');
    });

    it('takes a number without the plus', () => {
      expect(failedProperties(body({ phone: '79991234567' }))).toEqual([]);
    });

    it('refuses a plus anywhere but the front', () => {
      expect(failedProperties(body({ phone: '7999+1234567' }))).toEqual([
        'phone',
      ]);
    });
  });

  describe('cardholderName', () => {
    it('takes a name and trims it', () => {
      expect(failedProperties(body({ cardholderName: 'IVAN IVANOV' }))).toEqual(
        [],
      );
      expect(
        parse(body({ cardholderName: '  IVAN IVANOV  ' })).cardholderName,
      ).toBe('IVAN IVANOV');
    });

    it('refuses a name past 100 characters', () => {
      expect(
        failedProperties(body({ cardholderName: 'A'.repeat(101) })),
      ).toEqual(['cardholderName']);
    });
  });

  describe('the amounts and limits', () => {
    const amounts = [
      'minAmount',
      'maxAmount',
      'dailyAmountLimit',
      'monthlyAmountLimit',
    ];
    const counts = [
      'dailyLimit',
      'monthlyLimit',
      'maxActiveTransactions',
      'delayBetweenRequests',
    ];
    const values = [...amounts, ...counts];

    const toggles = values.map((field) => `${field}Enabled`);

    it.each(amounts)('takes %s as a fiat string with kopecks', (field) => {
      expect(failedProperties(body({ [field]: '500.50' }))).toEqual([]);
      expect(parse(body({ [field]: '500.50' }))[field]).toBe('500.50');
    });

    it.each(amounts)(
      'refuses %s as a JSON number, with a third decimal or negative',
      (field) => {
        for (const value of [500, '500.505', '-1']) {
          expect(failedProperties(body({ [field]: value }))).toEqual([field]);
        }
      },
    );

    it.each(counts)('takes %s as an integer', (field) => {
      expect(failedProperties(body({ [field]: 500 }))).toEqual([]);
      expect(parse(body({ [field]: '500' }))[field]).toBe(500);
    });

    it.each(counts)('refuses a negative %s', (field) => {
      expect(failedProperties(body({ [field]: -1 }))).toEqual([field]);
    });

    it.each(toggles)('takes %s as a boolean', (field) => {
      expect(failedProperties(body({ [field]: true }))).toEqual([]);
    });

    it.each(toggles)('refuses %s as anything but a boolean', (field) => {
      expect(failedProperties(body({ [field]: 'yes' }))).toEqual([field]);
    });

    it('leaves every one of them absent when they were not given', () => {
      const parsed = parse(body());

      for (const field of [...values, ...toggles]) {
        expect(parsed[field]).toBeUndefined();
      }
    });

    it('lets a limit through beside a toggle that contradicts it, and leaves the service to null it', () => {
      expect(
        failedProperties(body({ minAmountEnabled: false, minAmount: '500' })),
      ).toEqual([]);
    });
  });

  describe('the standing flags', () => {
    it.each(['counterpartyOnly', 'reserve'])(
      'takes %s as a boolean',
      (field) => {
        expect(failedProperties(body({ [field]: true }))).toEqual([]);
        expect(failedProperties(body({ [field]: 'yes' }))).toEqual([field]);
      },
    );
  });

  it('accepts details carrying neither a card nor a phone, which nothing forbids today', () => {
    expect(failedProperties(body({ card: undefined }))).toEqual([]);
  });
});
