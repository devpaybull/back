import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Response } from 'express';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { PasswordController } from '../controllers/password.controller';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../refresh-cookie';
import { PasswordService } from '../services/password.service';

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 900,
  refreshExpiresIn: 2592000,
};

const caller = (): AuthenticatedUser => ({
  id: uuidOf(7),
  login: 'user@example.com',
  role: Role.Trader,
  status: UserStatus.Active,
});

describe('PasswordController', () => {
  const passwords = {
    changePassword: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  };

  const response = () =>
    ({ cookie: jest.fn(), clearCookie: jest.fn() }) as unknown as Response;

  let controller: PasswordController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [PasswordController],
      providers: [
        { provide: PasswordService, useValue: passwords },
        { provide: UserDirectoryService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();

    controller = module.get(PasswordController);
  });

  it('marks the password change as a write, so a suspended account cannot use it', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        PasswordController.prototype.changePassword,
      ),
    ).toBe(true);
  });

  it('leaves recovery unmarked, since it is reached without a session', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        PasswordController.prototype.forgotPassword,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        PasswordController.prototype.resetPassword,
      ),
    ).toBeUndefined();
  });

  it('opens recovery to callers with no session, and only recovery', () => {
    expect(
      Reflect.getMetadata(
        PUBLIC_METADATA_KEY,
        PasswordController.prototype.forgotPassword,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        PUBLIC_METADATA_KEY,
        PasswordController.prototype.resetPassword,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        PUBLIC_METADATA_KEY,
        PasswordController.prototype.changePassword,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PUBLIC_METADATA_KEY, PasswordController),
    ).toBeUndefined();
  });

  it('re-opens the caller session on a password change', async () => {
    passwords.changePassword.mockResolvedValue(session);
    const res = response();

    const body = await controller.changePassword(
      { currentPassword: 'password123', newPassword: 'newpassword123' },
      caller(),
      res,
    );

    expect(passwords.changePassword).toHaveBeenCalledWith(uuidOf(7), {
      currentPassword: 'password123',
      newPassword: 'newpassword123',
    });
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

  it('answers a forgotten password the same way whatever the login is', async () => {
    const bodies = [
      await controller.forgotPassword({ login: 'user@example.com' }),
      await controller.forgotPassword({ login: 'nobody@example.com' }),
      await controller.forgotPassword({ login: '@durov' }),
    ];

    expect(bodies).toEqual([
      { message: 'success' },
      { message: 'success' },
      { message: 'success' },
    ]);
    expect(passwords.forgotPassword).toHaveBeenCalledTimes(3);
  });

  it('answers a completed reset with a success message', async () => {
    const body = await controller.resetPassword({
      login: 'user@example.com',
      code: '123456',
      newPassword: 'newpassword123',
    });

    expect(passwords.resetPassword).toHaveBeenCalledWith({
      login: 'user@example.com',
      code: '123456',
      newPassword: 'newpassword123',
    });
    expect(body).toEqual({ message: 'success' });
  });
});
