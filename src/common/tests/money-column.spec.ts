import { ColumnNumericTransformer } from '../utils/column-numeric-transformer';
import { moneyColumn } from '../utils/money-column';

describe('moneyColumn', () => {
  it('is a numeric(20, 3) column with the numeric transformer', () => {
    const options = moneyColumn();

    expect(options.type).toBe('numeric');
    expect(options.precision).toBe(20);
    expect(options.scale).toBe(3);
    expect(options.transformer).toBeInstanceOf(ColumnNumericTransformer);
  });

  it('lets the caller add options such as nullable', () => {
    expect(moneyColumn({ nullable: true }).nullable).toBe(true);
  });
});
