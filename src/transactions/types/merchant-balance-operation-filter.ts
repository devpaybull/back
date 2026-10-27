import { MerchantBalanceOperationType } from './merchant-balance-operation-type.enum';

export interface MerchantBalanceOperationFilter {
  merchantId: string;
  from?: Date;
  to?: Date;
  types?: MerchantBalanceOperationType[];
}
