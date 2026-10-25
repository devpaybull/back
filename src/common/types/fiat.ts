import Decimal from 'decimal.js';

export type Fiat = Decimal & { readonly __unit: 'fiat' };
