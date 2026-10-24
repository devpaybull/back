import { ColumnOptions } from 'typeorm';
import { ColumnNumericTransformer } from '../../common/utils/column-numeric-transformer';

export function percentColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    type: 'numeric',
    precision: 6,
    scale: 3,
    transformer: new ColumnNumericTransformer(),
    ...options,
  };
}
