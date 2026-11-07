import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BankDetailsType } from '../types/bank-details-type.enum';
import { CreateBankDetailsDto } from '../dto/create-bank-details.dto';

const body = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  bankId: 1,
  deviceId: 1,
  type: BankDetailsType.CardOrSbp,
  card: '4400430212345678',
  dailyAmountLimit: '300000.00',
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

  it('requires type', () => {
    expect(failedProperties(body({ type: undefined }))).toEqual(['type']);
  });

  it.each(['bankId', 'mobileOperatorId'])(
    'leaves %s to the service, which knows what the type needs',
    (field) => {
      expect(failedProperties(body({ [field]: undefined }))).toEqual([]);
    },
  );

  it('refuses a mobile operator id that is not a positive integer', () => {
    expect(failedProperties(body({ mobileOperatorId: 0 }))).toEqual([
      'mobileOperatorId',
    ]);
  });

  it.each(Object.values(BankDetailsType))('accepts the type %s', (type) => {
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
      'hourlyAmountLimit',
    ];
    const counts = ['dailyLimit', 'monthlyLimit', 'maxActiveTransactions'];
    const values = [...amounts, ...counts, 'delayBetweenRequests'];

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
      const parsed = parse(body({ dailyAmountLimit: undefined }));

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

  describe('what a requisite must carry', () => {
    it('requires a device', () => {
      expect(failedProperties(body({ deviceId: undefined }))).toEqual([
        'deviceId',
      ]);
    });

    it('requires the daily turnover limit', () => {
      expect(failedProperties(body({ dailyAmountLimit: undefined }))).toEqual([
        'dailyAmountLimit',
      ]);
    });

    it('refuses to switch the daily turnover limit off', () => {
      expect(
        failedProperties(body({ dailyAmountLimitEnabled: false })),
      ).toEqual(['dailyAmountLimitEnabled']);
    });
  });

  describe('delayBetweenRequests', () => {
    it.each([5, 30, 60, 300, 900, 1800, 3600, 10800])(
      'takes %s seconds',
      (seconds) => {
        expect(
          failedProperties(body({ delayBetweenRequests: seconds })),
        ).toEqual([]);
        expect(
          parse(body({ delayBetweenRequests: String(seconds) }))
            .delayBetweenRequests,
        ).toBe(seconds);
      },
    );

    it.each([0, 10, 120, 10801, -5])('refuses %s seconds', (seconds) => {
      expect(failedProperties(body({ delayBetweenRequests: seconds }))).toEqual(
        ['delayBetweenRequests'],
      );
    });
  });

  describe('maxCounterparties', () => {
    it('takes a positive integer with no ceiling below int4', () => {
      expect(failedProperties(body({ maxCounterparties: 2147483647 }))).toEqual(
        [],
      );
    });

    it.each([0, -1, 1.5, 2147483648])('refuses %s', (value) => {
      expect(failedProperties(body({ maxCounterparties: value }))).toEqual([
        'maxCounterparties',
      ]);
    });
  });

  describe('tagIds', () => {
    it('takes a list of distinct ids', () => {
      expect(failedProperties(body({ tagIds: [1, 2] }))).toEqual([]);
    });

    it.each([[[1, 1]], [[0]], [['a']], ['1']])('refuses %p', (tagIds) => {
      expect(failedProperties(body({ tagIds }))).toEqual(['tagIds']);
    });
  });

  describe('the standing flags', () => {
    it.each(['counterpartyOnly', 'reserve', 'sameBankOnly'])(
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
