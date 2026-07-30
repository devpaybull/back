import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '../../users/types/user-status.enum';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { RolesGuard } from '../guards/roles.guard';
import { uuidOf } from './uuid-of.spec';

class AdminOnlyController {
  @Roles(Role.Admin)
  handler() {}
}

class OpenController {
  handler() {}
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  const contextFor = (
    controller: object,
    user?: AuthenticatedRequest['user'],
  ): ExecutionContext =>
    ({
      getHandler: () => controller.constructor.prototype.handler,
      getClass: () => controller.constructor,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as ExecutionContext;

  it('lets an endpoint without @Roles through', () => {
    expect(guard.canActivate(contextFor(new OpenController()))).toBe(true);
  });

  it('rejects an authenticated user with the wrong role', () => {
    expect(() =>
      guard.canActivate(
        contextFor(new AdminOnlyController(), {
          id: uuidOf(1),
          login: 'user@example.com',
          role: Role.Trader,
          status: UserStatus.Active,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request that carries no user at all', () => {
    expect(() =>
      guard.canActivate(contextFor(new AdminOnlyController())),
    ).toThrow(ForbiddenException);
  });

  it('lets an admin through', () => {
    expect(
      guard.canActivate(
        contextFor(new AdminOnlyController(), {
          id: uuidOf(1),
          login: 'admin@example.com',
          role: Role.Admin,
          status: UserStatus.Active,
        }),
      ),
    ).toBe(true);
  });
});
