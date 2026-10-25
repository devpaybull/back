import { ColumnOptions } from 'typeorm';
import { DecimalColumnTransformer } from './decimal-column-transformer';
import { FIAT_SCALE } from './fiat-scale';

export function fiatColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    type: 'numeric',
    precision: 20,
    scale: FIAT_SCALE,
    transformer: new DecimalColumnTransformer(FIAT_SCALE),
    ...options,
  };
}
