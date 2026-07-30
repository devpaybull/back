import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '../../users/types/user-status.enum';
import { WRITE_ACCESS_METADATA_KEY } from '../decorators/write-access.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class WriteAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const changesData = this.reflector.getAllAndOverride<boolean>(
      WRITE_ACCESS_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!changesData) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (user?.status === UserStatus.Suspended) {
      throw new ForbiddenException('Account is suspended and cannot write');
    }

    return true;
  }
}
