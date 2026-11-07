import { toFiat } from '../../common/utils/to-fiat';
import { toOwnBankDetailsDto } from '../dto/own-bank-details.dto';
import { BankDetails } from '../entities/bank-details.entity';

const extras = {
  turnover: {
    total: toFiat('1500.5'),
    today: toFiat(0),
    month: toFiat('700.25'),
  },
  usage: { dealsToday: 4, lastHourAmount: toFiat('250') },
  boundCounterparties: 2,
  tags: [{ id: 7, name: 'Сбер' }],
};

describe('toOwnBankDetailsDto, the amount limits', () => {
  const details = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: 'bd-1',
      bankId: 1,
      minAmountEnabled: true,
      minAmount: toFiat('500.5'),
      maxAmountEnabled: true,
      maxAmount: toFiat(100000),
      dailyAmountLimitEnabled: true,
      dailyAmountLimit: toFiat('300000'),
      monthlyAmountLimitEnabled: true,
      monthlyAmountLimit: toFiat('2500000.99'),
      counterpartyOnly: false,
      ...overrides,
    }) as BankDetails;

  it('renders every amount limit as a fiat string with two decimals', () => {
    const dto = toOwnBankDetailsDto(details(), toFiat(5000), extras);

    expect(dto.minAmount).toBe('500.50');
    expect(dto.maxAmount).toBe('100000.00');
    expect(dto.dailyAmountLimit).toBe('300000.00');
    expect(dto.monthlyAmountLimit).toBe('2500000.99');
  });

  it('shows the configured floor, with kopecks, for a counterparty-only requisite', () => {
    const dto = toOwnBankDetailsDto(
      details({ counterpartyOnly: true, minAmount: null }),
      toFiat('5000.5'),
      extras,
    );

    expect(dto.minAmountEnabled).toBe(true);
    expect(dto.minAmount).toBe('5000.50');
  });
});

describe('toOwnBankDetailsDto, what the list adds to the row', () => {
  const row = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: 'bd-1',
      active: true,
      bannedAt: null,
      counterpartyOnly: true,
      maxCounterparties: 8,
      sameBankOnly: true,
      hourlyAmountLimitEnabled: true,
      hourlyAmountLimit: toFiat('50000'),
      ...overrides,
    }) as BankDetails;

  it('carries the turnover, the usage, the slots and the tags', () => {
    expect(toOwnBankDetailsDto(row(), toFiat(5000), extras)).toMatchObject({
      turnoverTotal: '1500.50',
      turnoverToday: '0.00',
      turnoverMonth: '700.25',
      dealsToday: 4,
      lastHourAmount: '250.00',
      maxCounterparties: 8,
      boundCounterparties: 2,
      sameBankOnly: true,
      hourlyAmountLimitEnabled: true,
      hourlyAmountLimit: '50000.00',
      tags: [{ id: 7, name: 'Сбер' }],
    });
  });

  it.each([
    [{ active: true, bannedAt: null }, 'active'],
    [{ active: false, bannedAt: null }, 'disabled'],
    [{ active: true, bannedAt: new Date() }, 'banned'],
    [{ active: false, bannedAt: new Date() }, 'banned'],
  ])('derives the status of %p as %s', (overrides, status) => {
    expect(
      toOwnBankDetailsDto(
        row(overrides as Partial<BankDetails>),
        toFiat(0),
        extras,
      ).status,
    ).toBe(status);
  });
});
