import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateBankDetailsDto } from '../dto/update-bank-details.dto';

const failedProperties = (given: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(UpdateBankDetailsDto, given)).map(
    (error) => error.property,
  );

describe('UpdateBankDetailsDto, the amount limits', () => {
  const amounts = [
    'minAmount',
    'maxAmount',
    'dailyAmountLimit',
    'monthlyAmountLimit',
    'hourlyAmountLimit',
  ];

  it.each(amounts)('takes %s as a fiat string with kopecks', (field) => {
    expect(failedProperties({ [field]: '500.50' })).toEqual([]);
  });

  it.each(amounts)(
    'refuses %s as a JSON number, with a third decimal or negative',
    (field) => {
      for (const value of [500, '500.505', '-1']) {
        expect(failedProperties({ [field]: value })).toEqual([field]);
      }
    },
  );

  it.each(amounts)(
    'lets %s through as null, leaving the switch to settle it',
    (field) => {
      expect(failedProperties({ [field]: null })).toEqual([]);
    },
  );
});

describe('UpdateBankDetailsDto, the trader-cabinet fields', () => {
  it('refuses to switch the daily turnover limit off', () => {
    expect(failedProperties({ dailyAmountLimitEnabled: false })).toEqual([
      'dailyAmountLimitEnabled',
    ]);
    expect(failedProperties({ dailyAmountLimitEnabled: true })).toEqual([]);
  });

  it('takes a delay only from the set', () => {
    expect(failedProperties({ delayBetweenRequests: 1800 })).toEqual([]);
    expect(failedProperties({ delayBetweenRequests: 120 })).toEqual([
      'delayBetweenRequests',
    ]);
  });

  it('takes an empty tag list, which clears the tags', () => {
    expect(failedProperties({ tagIds: [] })).toEqual([]);
  });

  it('takes the slots, the same-bank flag and the hourly switch', () => {
    expect(
      failedProperties({
        maxCounterparties: 5,
        sameBankOnly: true,
        hourlyAmountLimitEnabled: true,
      }),
    ).toEqual([]);
  });
});
