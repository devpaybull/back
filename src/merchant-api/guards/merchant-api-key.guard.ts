import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MerchantIpAddressesService } from '../../merchants/services/merchant-ip-addresses.service';
import { MerchantsService } from '../../merchants/services/merchants.service';
import { SKIP_IP_CHECK_METADATA_KEY } from '../decorators/skip-ip-check.decorator';
import { MerchantApiErrorCode } from '../types/merchant-api-error-code.enum';
import { MerchantApiRequest } from '../types/merchant-api-request';

const API_KEY_HEADER = 'x-secure-key';

@Injectable()
export class MerchantApiKeyGuard implements CanActivate {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly addresses: MerchantIpAddressesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MerchantApiRequest>();
    const header = request.headers[API_KEY_HEADER];
    const key = typeof header === 'string' ? header.trim() : '';
    const found = key ? await this.merchants.authenticateKey(key) : null;

    if (!found) {
      throw new UnauthorizedException({
        code: MerchantApiErrorCode.InvalidApiKey,
        message: 'Invalid API key',
      });
    }

    request.apiMerchant = {
      merchantId: found.merchantId,
      apiKeyId: found.apiKeyId,
    };

    if (!found.merchantActive) {
      throw new ForbiddenException({
        code: MerchantApiErrorCode.MerchantDisabled,
        message: 'The merchant is disabled',
      });
    }

    const skipIpCheck = this.reflector.getAllAndOverride<boolean | undefined>(
      SKIP_IP_CHECK_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      !skipIpCheck &&
      !(await this.addresses.admits(found.merchantId, request.ip))
    ) {
      throw new ForbiddenException({
        code: MerchantApiErrorCode.IpNotAllowed,
        message: 'The IP address is not allowed',
      });
    }

    return true;
  }
}
