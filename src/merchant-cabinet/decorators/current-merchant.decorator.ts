import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MerchantScopedRequest } from '../types/merchant-scoped-request';

export const CurrentMerchant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<MerchantScopedRequest>()
      .merchantId as string,
);
