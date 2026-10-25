import Decimal from 'decimal.js';
import { ValueTransformer } from 'typeorm';
import { roundHalfEven } from './round-half-even';
import { toDecimal } from './to-decimal';

export class DecimalColumnTransformer implements ValueTransformer {
  constructor(readonly scale: number) {}

  to(value: unknown): unknown {
    return Decimal.isDecimal(value)
      ? roundHalfEven(value, this.scale).toFixed(this.scale)
      : value;
  }

  from(value: string | null | undefined): Decimal | null {
    return value === null || value === undefined ? null : toDecimal(value);
  }
}
