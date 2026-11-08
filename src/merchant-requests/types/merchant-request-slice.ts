import { MerchantRequestFilter } from './merchant-request-filter';

export interface MerchantRequestSlice extends MerchantRequestFilter {
  counterpartyId?: number;
  present?: { field: 'amountFiat' | 'payerUserId'; is: boolean };
}
