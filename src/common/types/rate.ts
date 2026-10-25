import Decimal from 'decimal.js';

export type Rate = Decimal & { readonly __unit: 'rate' };
