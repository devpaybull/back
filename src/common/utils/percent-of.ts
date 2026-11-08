import { toDecimal } from './to-decimal';

const PERCENT = 100;
const PERCENT_DECIMALS = 2;

export function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null;

  return toDecimal(part)
    .times(PERCENT)
    .div(whole)
    .toDecimalPlaces(PERCENT_DECIMALS)
    .toNumber();
}
