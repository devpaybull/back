import { MerchantStatus } from './merchant-status.enum';

export interface MerchantListQuery {
  search?: string;
  status?: MerchantStatus;
  exclusiveTopUp?: boolean;
}
