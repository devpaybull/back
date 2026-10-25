import { ColumnOptions } from 'typeorm';
import { DecimalColumnTransformer } from './decimal-column-transformer';
import { RATE_SCALE } from './rate-scale';

export function rateColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    type: 'numeric',
    precision: 20,
    scale: RATE_SCALE,
    transformer: new DecimalColumnTransformer(RATE_SCALE),
    ...options,
  };
}
