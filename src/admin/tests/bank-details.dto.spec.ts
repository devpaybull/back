import { toFiat } from '../../common/utils/to-fiat';
import { BankDetails } from '../../bank-details/entities/bank-details.entity';
import { toBankDetailsDto } from '../dto/bank-details.dto';

describe('toBankDetailsDto, the amounts', () => {
  const turnover = {
    total: toFiat('1500.5'),
    today: toFiat(0),
    month: toFiat('700.25'),
  };

  it('shows the configured floor, with kopecks, for a counterparty-only requisite', () => {
    const dto = toBankDetailsDto(
      { id: 'bd-1', counterpartyOnly: true, minAmount: null } as BankDetails,
      toFiat('5000.5'),
      turnover,
    );

    expect(dto.minAmountEnabled).toBe(true);
    expect(dto.minAmount).toBe('5000.50');
  });

  it('renders the limits and the turnover as fiat strings with two decimals', () => {
    const dto = toBankDetailsDto(
      {
        id: 'bd-1',
        counterpartyOnly: false,
        maxAmountEnabled: true,
        maxAmount: toFiat(100000),
      } as BankDetails,
      toFiat(5000),
      turnover,
    );

    expect(dto.maxAmount).toBe('100000.00');
    expect(dto.turnoverTotal).toBe('1500.50');
    expect(dto.turnoverToday).toBe('0.00');
    expect(dto.turnoverMonth).toBe('700.25');
  });
});
