import { AuthenticatedRequest } from '../../common/types/authenticated-request';

export interface MerchantScopedRequest extends AuthenticatedRequest {
  merchantId?: string;
}
