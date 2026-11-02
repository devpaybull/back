import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { UserStatus } from '../../users/types/user-status.enum';
import { MerchantScopeGuard } from '../guards/merchant-scope.guard';
import { MerchantScopedRequest } from '../types/merchant-scoped-request';

const MERCHANT = uuidOf(30);

describe('MerchantScopeGuard', () => {
  const build = (account: { merchantId: string | null } | null) => {
    const directory = { findById: jest.fn(async () => account) };

    return {
      directory,
      guard: new MerchantScopeGuard(directory as never),
    };
  };

  const contextOf = (request: MerchantScopedRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as ExecutionContext;

  const requestOf = (role: Role): MerchantScopedRequest =>
    ({
      user: {
        id: uuidOf(1),
        login: 'shop',
        role,
        status: UserStatus.Active,
      },
    }) as MerchantScopedRequest;

  it.each([Role.Merchant, Role.MerchantSupport, Role.MerchantAgent])(
    'puts the merchant of a %s account on the request, read from the database',
    async (role) => {
      const { guard, directory } = build({ merchantId: MERCHANT });
      const request = requestOf(role);

      await expect(guard.canActivate(contextOf(request))).resolves.toBe(true);
      expect(directory.findById).toHaveBeenCalledWith(uuidOf(1));
      expect(request.merchantId).toBe(MERCHANT);
    },
  );

  it.each([Role.Trader, Role.LeadTrader, Role.Admin, Role.Superadmin])(
    'refuses a %s with a 403 before reading anything',
    async (role) => {
      const { guard, directory } = build({ merchantId: MERCHANT });

      await expect(
        guard.canActivate(contextOf(requestOf(role))),
      ).rejects.toThrow(ForbiddenException);
      expect(directory.findById).not.toHaveBeenCalled();
    },
  );

  it('refuses a merchant-side account bound to no merchant with a 403', async () => {
    const { guard } = build({ merchantId: null });

    await expect(
      guard.canActivate(contextOf(requestOf(Role.MerchantSupport))),
    ).rejects.toThrow('The account is not bound to a merchant');
  });

  it('refuses a request with no user', async () => {
    const { guard } = build(null);

    await expect(
      guard.canActivate(contextOf({} as MerchantScopedRequest)),
    ).rejects.toThrow(ForbiddenException);
  });
});
