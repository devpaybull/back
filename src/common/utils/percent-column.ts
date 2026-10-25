import { ColumnOptions } from 'typeorm';
import { ColumnNumericTransformer } from './column-numeric-transformer';
import { PERCENT_SCALE } from './percent-scale';

export function percentColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    type: 'numeric',
    precision: 6,
    scale: PERCENT_SCALE,
    transformer: new ColumnNumericTransformer(),
    ...options,
  };
}
