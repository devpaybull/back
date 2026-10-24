import { ColumnNumericTransformer } from '../utils/column-numeric-transformer';
import { percentColumn } from '../utils/percent-column';

describe('percentColumn', () => {
  it('is a numeric(6, 3) column with the numeric transformer', () => {
    const options = percentColumn();

    expect(options.type).toBe('numeric');
    expect(options.precision).toBe(6);
    expect(options.scale).toBe(3);
    expect(options.transformer).toBeInstanceOf(ColumnNumericTransformer);
  });

  it('lets the caller add options such as nullable', () => {
    expect(percentColumn({ nullable: true }).nullable).toBe(true);
  });
});
