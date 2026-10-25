import { toFiat } from '../../common/utils/to-fiat';
import { toOwnBankDetailsDto } from '../dto/own-bank-details.dto';
import { BankDetails } from '../entities/bank-details.entity';

describe('toOwnBankDetailsDto, the amount limits', () => {
  const details = (overrides: Partial<BankDetails> = {}): BankDetails =>
    ({
      id: 'bd-1',
      bankId: 1,
      minAmountEnabled: true,
      minAmount: toFiat('500.5'),
      maxAmountEnabled: true,
      maxAmount: toFiat(100000),
      dailyAmountLimitEnabled: false,
      dailyAmountLimit: null,
      monthlyAmountLimitEnabled: true,
      monthlyAmountLimit: toFiat('2500000.99'),
      counterpartyOnly: false,
      ...overrides,
    }) as BankDetails;

  it('renders every amount limit as a fiat string with two decimals', () => {
    const dto = toOwnBankDetailsDto(details(), toFiat(5000));

    expect(dto.minAmount).toBe('500.50');
    expect(dto.maxAmount).toBe('100000.00');
    expect(dto.dailyAmountLimit).toBeNull();
    expect(dto.monthlyAmountLimit).toBe('2500000.99');
  });

  it('shows the configured floor, with kopecks, for a counterparty-only requisite', () => {
    const dto = toOwnBankDetailsDto(
      details({ counterpartyOnly: true, minAmount: null }),
      toFiat('5000.5'),
    );

    expect(dto.minAmountEnabled).toBe(true);
    expect(dto.minAmount).toBe('5000.50');
  });
});
