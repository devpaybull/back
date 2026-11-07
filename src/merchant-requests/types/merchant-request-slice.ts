import { MerchantRequestFilter } from './merchant-request-filter';

export interface MerchantRequestSlice extends MerchantRequestFilter {
  present?: { field: 'amountFiat' | 'payerUserId'; is: boolean };
}
