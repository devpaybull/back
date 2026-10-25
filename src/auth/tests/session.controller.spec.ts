import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Request, Response } from 'express';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { JsonContentTypeGuard } from '../../common/guards/json-content-type.guard';
import { SessionController } from '../controllers/session.controller';
import { RedeemLoginLinkDto } from '../dto/redeem-login-link.dto';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../refresh-cookie';
import { LoginLinkService } from '../services/login-link.service';
import { SessionService } from '../services/session.service';

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 900,
  refreshExpiresIn: 2592000,
};

const loginRequest = {
  ip: '203.0.113.7',
  get: jest.fn(() => 'agent/1.0'),
} as unknown as Request;

const expectedContext = (fingerprint: string | null) => ({
  ip: '203.0.113.7',
  userAgent: 'agent/1.0',
  fingerprint,
});

describe('SessionController', () => {
  const sessions = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };

  const loginLinks = { redeem: jest.fn() };

  const response = () =>
    ({ cookie: jest.fn(), clearCookie: jest.fn() }) as unknown as Response;

  const request = (cookies: Record<string, string> = {}) =>
    ({ cookies }) as unknown as Request;

  let controller: SessionController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: SessionService, useValue: sessions },
        { provide: LoginLinkService, useValue: loginLinks },
      ],
    }).compile();

    controller = module.get(SessionController);
  });

  it('is reachable without an access token, or nobody could ever log in', () => {
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, SessionController)).toBe(
      true,
    );
  });

  it('keeps the refresh token out of the login body and in an httpOnly cookie', async () => {
    sessions.login.mockResolvedValue(session);
    const res = response();

    const body = await controller.login(
      {
        login: 'user@example.com',
        password: 'password123',
        totp: '123456',
        fingerprint: 'fp-1',
      },
      loginRequest,
      res,
    );

    expect(sessions.login).toHaveBeenCalledWith(
      expect.objectContaining({ login: 'user@example.com' }),
      expectedContext('fp-1'),
    );

    expect(body).toEqual({ accessToken: 'access-token', expiresIn: 900 });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        maxAge: 2592000 * 1000,
      }),
    );
  });

  it('refuses to refresh without the cookie', async () => {
    await expect(
      controller.refresh(request(), response()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.refresh).not.toHaveBeenCalled();
  });

  it('rotates the cookie on refresh', async () => {
    sessions.refresh.mockResolvedValue({ ...session, refreshToken: 'rotated' });
    const res = response();

    await controller.refresh(
      request({ [REFRESH_COOKIE_NAME]: 'refresh-token' }),
      res,
    );

    expect(sessions.refresh).toHaveBeenCalledWith('refresh-token');
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'rotated',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
      }),
    );
  });

  it('revokes and clears the cookie on logout', async () => {
    const res = response();

    const body = await controller.logout(
      request({ [REFRESH_COOKIE_NAME]: 'refresh-token' }),
      res,
    );

    expect(sessions.logout).toHaveBeenCalledWith('refresh-token');
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
      }),
    );
    expect(body).toBeNull();
  });

  describe('redeemLoginLink', () => {
    it('is guarded so only application/json reaches it', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        SessionController.prototype.redeemLoginLink,
      ) as unknown[];

      expect(guards).toContain(JsonContentTypeGuard);
    });

    it('hands the code alone to the service, with no login context, and sets the same cookie a login does', async () => {
      loginLinks.redeem.mockResolvedValue(session);
      const res = response();

      const body = await controller.redeemLoginLink(
        { code: 'the-code', fingerprint: 'fp-2' },
        res,
      );

      expect(loginLinks.redeem).toHaveBeenCalledWith('the-code');
      expect(body).toEqual({ accessToken: 'access-token', expiresIn: 900 });
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'refresh-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: REFRESH_COOKIE_PATH,
          maxAge: 2592000 * 1000,
        }),
      );
    });

    it('sets no cookie when the service refuses the code', async () => {
      loginLinks.redeem.mockRejectedValue(new UnauthorizedException());
      const res = response();

      await expect(
        controller.redeemLoginLink({ code: 'the-code' }, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it.each([{}, { code: '' }, { code: 42 }, { code: 'x'.repeat(129) }])(
      'refuses the body %p',
      (body) => {
        expect(
          validateSync(plainToInstance(RedeemLoginLinkDto, body)),
        ).not.toHaveLength(0);
      },
    );
  });
});
