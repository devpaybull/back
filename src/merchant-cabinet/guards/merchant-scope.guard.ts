import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MERCHANT_SIDE_ROLES } from '../../common/utils/merchant-side-roles';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { MerchantScopedRequest } from '../types/merchant-scoped-request';

@Injectable()
export class MerchantScopeGuard implements CanActivate {
  constructor(private readonly directory: UserDirectoryService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MerchantScopedRequest>();

    if (!request.user || !MERCHANT_SIDE_ROLES.includes(request.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    const account = await this.directory.findById(request.user.id);

    if (!account?.merchantId) {
      throw new ForbiddenException('The account is not bound to a merchant');
    }

    request.merchantId = account.merchantId;

    return true;
  }
}
