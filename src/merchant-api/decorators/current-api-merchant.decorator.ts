import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiMerchant } from '../types/api-merchant';
import { MerchantApiRequest } from '../types/merchant-api-request';

export const CurrentApiMerchant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiMerchant =>
    context.switchToHttp().getRequest<MerchantApiRequest>()
      .apiMerchant as ApiMerchant,
);
