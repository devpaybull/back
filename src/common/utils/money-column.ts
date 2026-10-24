import { ColumnOptions } from 'typeorm';
import { ColumnNumericTransformer } from './column-numeric-transformer';

export function moneyColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    type: 'numeric',
    precision: 20,
    scale: 3,
    transformer: new ColumnNumericTransformer(),
    ...options,
  };
}
