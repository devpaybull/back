import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../../auth/services/session.service';
import { User } from '../../users/entities/user.entity';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { Role } from '../enums/role.enum';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { TokenType } from '../types/token';
import { uuidOf } from './uuid-of.spec';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-here';
const LIVE_SESSION = 42;

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({});
  const directory = { findAuthenticatableById: jest.fn() };
  const sessions = { findLiveSession: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new JwtAuthGuard(
    jwt,
    { get: () => ACCESS_SECRET } as unknown as ConfigService,
    directory as unknown as UserDirectoryService,
    sessions as unknown as SessionService,
    reflector as unknown as Reflector,
  );

  const contextFor = (
    authorization: string,
  ): { context: ExecutionContext; request: AuthenticatedRequest } => {
    const request = { headers: { authorization } } as AuthenticatedRequest;

    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as unknown as ExecutionContext,
    };
  };

  const accessToken = (
    payload: Record<string, unknown>,
    secret = ACCESS_SECRET,
  ) => jwt.sign(payload, { secret, expiresIn: 900 });

  const claims = (overrides: Record<string, unknown> = {}) => ({
    sub: uuidOf(1),
    sid: LIVE_SESSION,
    login: 'user@example.com',
    role: Role.Trader,
    type: TokenType.Access,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.findLiveSession.mockResolvedValue({
      id: LIVE_SESSION,
      impersonatedByUserId: null,
    });
    reflector.getAllAndOverride.mockReturnValue(undefined);
  });

  it('lets a public handler through without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const { context, request } = contextFor(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(directory.findAuthenticatableById).not.toHaveBeenCalled();
  });

  it('rejects a request without a bearer token', async () => {
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with another secret', async () => {
    const { context } = contextFor(
      `Bearer ${accessToken(claims(), 'another-secret-that-is-long-enough-ok')}`,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(directory.findAuthenticatableById).not.toHaveBeenCalled();
  });

  it('rejects a refresh token used as an access token', async () => {
    const { context } = contextFor(
      `Bearer ${accessToken(claims({ type: TokenType.Refresh }))}`,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(claims(), {
      secret: ACCESS_SECRET,
      expiresIn: -1,
    });
    const { context } = contextFor(`Bearer ${expired}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token that names no session', async () => {
    const { context } = contextFor(
      `Bearer ${accessToken({
        sub: uuidOf(1),
        login: 'user@example.com',
        role: Role.Trader,
        type: TokenType.Access,
      })}`,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.findLiveSession).not.toHaveBeenCalled();
    expect(directory.findAuthenticatableById).not.toHaveBeenCalled();
  });

  it('rejects a token whose session was revoked by a logout', async () => {
    sessions.findLiveSession.mockResolvedValue(null);

    const { context } = contextFor(`Bearer ${accessToken(claims())}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.findLiveSession).toHaveBeenCalledWith(LIVE_SESSION);
    expect(directory.findAuthenticatableById).not.toHaveBeenCalled();
  });

  it('rejects a still valid token of a blocked account', async () => {
    directory.findAuthenticatableById.mockResolvedValue(null);

    const { context } = contextFor(`Bearer ${accessToken(claims())}`);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('puts the caller on the request', async () => {
    directory.findAuthenticatableById.mockResolvedValue({
      id: uuidOf(1),
      email: 'admin@example.com',
      telegramUsername: null,
      role: Role.Admin,
      status: UserStatus.Active,
    } as User);

    const { context, request } = contextFor(
      `Bearer ${accessToken(claims({ login: 'admin@example.com', role: Role.Admin }))}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(directory.findAuthenticatableById).toHaveBeenCalledWith(uuidOf(1));
    expect(request.user).toEqual({
      id: uuidOf(1),
      login: 'admin@example.com',
      role: Role.Admin,
      status: UserStatus.Active,
      impersonatedBy: null,
    });
  });

  it('takes the login of a telegram account from the stored username', async () => {
    directory.findAuthenticatableById.mockResolvedValue({
      id: uuidOf(7),
      email: null,
      telegramUsername: 'durov',
      role: Role.Trader,
      status: UserStatus.Active,
    } as User);

    const { context, request } = contextFor(
      `Bearer ${accessToken(claims({ sub: uuidOf(7), login: 'durov' }))}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.login).toBe('durov');
  });

  it('takes the telegram username as the login when the account holds both', async () => {
    directory.findAuthenticatableById.mockResolvedValue({
      id: uuidOf(7),
      email: 'durov@example.com',
      telegramUsername: 'durov',
      role: Role.Trader,
      status: UserStatus.Active,
    } as User);

    const { context, request } = contextFor(
      `Bearer ${accessToken(claims({ sub: uuidOf(7), login: 'durov@example.com' }))}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.login).toBe('durov');
  });

  it('prefers the stored role and status over the claims of the token', async () => {
    directory.findAuthenticatableById.mockResolvedValue({
      id: uuidOf(1),
      email: 'user@example.com',
      telegramUsername: null,
      role: Role.Trader,
      status: UserStatus.Suspended,
    } as User);

    const { context, request } = contextFor(
      `Bearer ${accessToken(claims({ role: Role.Admin }))}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: uuidOf(1),
      login: 'user@example.com',
      role: Role.Trader,
      status: UserStatus.Suspended,
      impersonatedBy: null,
    });
  });

  it('names the superadmin a login-link session was opened by, from the one session read', async () => {
    sessions.findLiveSession.mockResolvedValue({
      id: LIVE_SESSION,
      impersonatedByUserId: uuidOf(5),
    });
    directory.findAuthenticatableById.mockResolvedValue({
      id: uuidOf(1),
      email: 'user@example.com',
      telegramUsername: null,
      role: Role.Trader,
      status: UserStatus.Active,
    } as User);

    const { context, request } = contextFor(`Bearer ${accessToken(claims())}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.impersonatedBy).toBe(uuidOf(5));
    expect(sessions.findLiveSession).toHaveBeenCalledTimes(1);
    expect(directory.findAuthenticatableById).toHaveBeenCalledTimes(1);
  });
});
