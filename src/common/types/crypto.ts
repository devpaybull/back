import Decimal from 'decimal.js';

export type Crypto = Decimal & { readonly __unit: 'crypto' };
