import { ColumnOptions } from 'typeorm';
import { DecimalColumnTransformer } from './decimal-column-transformer';
import { CRYPTO_SCALE } from './crypto-scale';

export function cryptoColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    type: 'numeric',
    precision: 20,
    scale: CRYPTO_SCALE,
    transformer: new DecimalColumnTransformer(CRYPTO_SCALE),
    ...options,
  };
}
