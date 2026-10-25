import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../../auth/services/session.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { PUBLIC_METADATA_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { AccessTokenPayload, TokenType } from '../types/token';
import { loginOf } from '../utils/login-of';

const BEARER_PREFIX = 'Bearer ';
const ACCESS_REJECTED = 'Access token is invalid or expired';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly directory: UserDirectoryService,
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';

    if (!header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('Access token is missing');
    }

    const payload = await this.verifyAccessToken(
      header.slice(BEARER_PREFIX.length),
    );

    const session = await this.sessions.findLiveSession(payload.sid);

    if (!session) {
      throw new UnauthorizedException(ACCESS_REJECTED);
    }

    const user = await this.directory.findAuthenticatableById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(ACCESS_REJECTED);
    }

    request.user = {
      id: user.id,
      login: loginOf(user),
      role: user.role,
      status: user.status,
      impersonatedBy: session.impersonatedByUserId ?? null,
    };

    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(ACCESS_REJECTED);
    }

    if (payload.type !== TokenType.Access) {
      throw new UnauthorizedException(ACCESS_REJECTED);
    }

    if (typeof payload.sid !== 'number') {
      throw new UnauthorizedException(ACCESS_REJECTED);
    }

    return payload;
  }
}
