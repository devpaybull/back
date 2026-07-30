import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '../../users/types/user-status.enum';
import {
  WRITE_ACCESS_METADATA_KEY,
  WriteAccess,
} from '../decorators/write-access.decorator';
import { Role } from '../enums/role.enum';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { WriteAccessGuard } from '../guards/write-access.guard';
import { uuidOf } from './uuid-of.spec';

class UnguardedController {}

describe('WriteAccessGuard', () => {
  const reflector = new Reflector();
  const guard = new WriteAccessGuard(reflector);

  let handler: () => void;

  const markAsWriting = () => WriteAccess()(handler);

  const contextFor = (status: UserStatus): ExecutionContext => {
    const request = {
      user: {
        id: uuidOf(1),
        login: 'user@example.com',
        role: Role.Trader,
        status,
      },
    } as AuthenticatedRequest;

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => UnguardedController,
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    handler = () => undefined;
  });

  it('marks the handler under the writeAccess metadata key', () => {
    markAsWriting();

    expect(reflector.get(WRITE_ACCESS_METADATA_KEY, handler)).toBe(true);
  });

  it('refuses a suspended caller on a handler that changes data', () => {
    markAsWriting();

    expect(() => guard.canActivate(contextFor(UserStatus.Suspended))).toThrow(
      ForbiddenException,
    );
  });

  it('lets an active caller through a handler that changes data', () => {
    markAsWriting();

    expect(guard.canActivate(contextFor(UserStatus.Active))).toBe(true);
  });

  it('lets a suspended caller through an unmarked handler', () => {
    expect(guard.canActivate(contextFor(UserStatus.Suspended))).toBe(true);
  });
});
