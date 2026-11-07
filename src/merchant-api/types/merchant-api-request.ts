import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { MerchantRequestDetails } from '../../merchant-requests/types/merchant-request-details';
import { ApiMerchant } from './api-merchant';

export interface MerchantApiRequest extends RawBodyRequest<Request> {
  apiMerchant?: ApiMerchant;
  requestId?: string;
  requestDetails?: MerchantRequestDetails;
}
