import { Test } from '@nestjs/testing';
import { Response } from 'express';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { EnrolmentController } from '../controllers/enrolment.controller';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../refresh-cookie';
import { EnrolmentService } from '../services/enrolment.service';

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 900,
  refreshExpiresIn: 2592000,
};

describe('EnrolmentController', () => {
  const enrolment = {
    register: jest.fn(),
    confirmRegistration: jest.fn(),
    startTwoFactorSetup: jest.fn(),
    confirmTwoFactorSetup: jest.fn(),
  };

  const response = () =>
    ({ cookie: jest.fn(), clearCookie: jest.fn() }) as unknown as Response;

  let controller: EnrolmentController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [EnrolmentController],
      providers: [{ provide: EnrolmentService, useValue: enrolment }],
    }).compile();

    controller = module.get(EnrolmentController);
  });

  it('is reachable without an access token, since nobody has one yet', () => {
    expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, EnrolmentController)).toBe(
      true,
    );
  });

  it('hands the registration QR code back untouched', async () => {
    const started = {
      registrationToken: 'registration-token',
      expiresIn: 900,
      otpauthUrl: 'otpauth://totp/Paybull:user@example.com?secret=SECRET',
      secret: 'SECRET',
      qrCode: 'data:image/png;base64,QR',
    };
    enrolment.register.mockResolvedValue(started);

    const body = await controller.register({
      login: 'user@example.com',
      password: 'password123',
      inviteCode: 'ABCDEFGHJKLMNPQR',
    });

    expect(body).toEqual(started);
  });

  it('returns the backup codes once, together with the first session', async () => {
    enrolment.confirmRegistration.mockResolvedValue({
      session,
      backupCodes: ['AAAAA-BBBBB'],
    });
    const res = response();

    const body = await controller.confirmRegistration(
      { registrationToken: 'token', totp: '123456' },
      res,
    );

    expect(body).toEqual({
      accessToken: 'access-token',
      expiresIn: 900,
      backupCodes: ['AAAAA-BBBBB'],
    });
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

  it('hands the new secret and its QR code back without opening a session', async () => {
    const started = {
      setupToken: 'setup-token',
      expiresIn: 900,
      otpauthUrl: 'otpauth://totp/Paybull:reset@example.com?secret=NEWSECRET',
      secret: 'NEWSECRET',
      qrCode: 'data:image/png;base64,QR',
    };
    enrolment.startTwoFactorSetup.mockResolvedValue(started);
    const res = response();

    const body = await controller.startTwoFactorSetup({
      login: 'reset@example.com',
      password: 'password123',
    });

    expect(body).toEqual(started);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('sets the refresh cookie when a re-enrolment is confirmed', async () => {
    enrolment.confirmTwoFactorSetup.mockResolvedValue({
      session,
      backupCodes: ['AAAAA-BBBBB'],
    });
    const res = response();

    const body = await controller.confirmTwoFactorSetup(
      { setupToken: 'setup-token', totp: '123456' },
      res,
    );

    expect(body).toEqual({
      accessToken: 'access-token',
      expiresIn: 900,
      backupCodes: ['AAAAA-BBBBB'],
    });
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
});
