import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TokenType } from '../../common/types/token';
import { renderQrCodeDataUrl } from '../../common/utils/render-qr-code-data-url';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { InvitesService } from '../../invites/invites.service';
import { User } from '../../users/entities/user.entity';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { UserEnrolmentService } from '../../users/services/user-enrolment.service';
import { UserStatus } from '../../users/types/user-status.enum';
import { RefreshToken } from '../entities/refresh-token.entity';
import { EnrolmentService } from '../services/enrolment.service';
import { SessionService } from '../services/session.service';

const ACCESS_SECRET = 'access-secret-that-is-long-enough-here';
const REFRESH_SECRET = 'refresh-secret-that-is-long-enough-here';
const REGISTRATION_SECRET = 'registration-secret-that-is-long-enough';

const ENV: Record<string, unknown> = {
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_REGISTRATION_SECRET: REGISTRATION_SECRET,
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 2592000,
  JWT_REGISTRATION_TTL_SECONDS: 900,
};

describe('EnrolmentService', () => {
  const activeUser = {
    id: uuidOf(1),
    email: 'user@example.com',
    telegramUsername: null,
    role: Role.Trader,
    status: UserStatus.Active,
  } as User;

  const telegramUser = {
    id: uuidOf(2),
    email: null,
    telegramUsername: 'durov',
    role: Role.Merchant,
    status: UserStatus.Active,
  } as User;

  const refreshTokens = {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<RefreshToken>) => ({ ...data })),
    save: jest.fn(async (token: RefreshToken) => token),
    update: jest.fn(),
  };

  const userCredentials = {
    verifyPassword: jest.fn(),
    verifySecondFactor: jest.fn(),
  };

  const userDirectory = {
    findAuthenticatableById: jest.fn(),
    findAuthenticatableByLogin: jest.fn(),
    findByLogin: jest.fn(),
  };

  const userEnrolment = {
    startRegistration: jest.fn(),
    startTwoFactorSetup: jest.fn(),
    confirmTwoFactor: jest.fn(),
  };

  const invites = {
    assertUsable: jest.fn(),
    consume: jest.fn(),
  };

  const jwt = new JwtService({});

  let service: EnrolmentService;

  const registrationToken = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, { secret: REGISTRATION_SECRET, expiresIn: 900 });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        EnrolmentService,
        SessionService,
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: UserCredentialsService, useValue: userCredentials },
        { provide: UserDirectoryService, useValue: userDirectory },
        { provide: UserEnrolmentService, useValue: userEnrolment },
        { provide: InvitesService, useValue: invites },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ENV[key] },
        },
      ],
    }).compile();

    service = module.get(EnrolmentService);
  });

  describe('register', () => {
    it('binds the registration token to the invite and the pending user', async () => {
      invites.assertUsable.mockResolvedValue({
        code: 'ABCDEFGHJKLMNPQR',
        role: Role.Trader,
      });
      userEnrolment.startRegistration.mockResolvedValue({
        user: activeUser,
        secret: 'SECRET',
        otpauthUrl: 'otpauth://totp/Paybull:user@example.com?secret=SECRET',
      });

      const result = await service.register({
        login: 'user@example.com',
        password: 'password123',
        inviteCode: 'abcd-efgh-jklm-npqr',
      });

      expect(invites.assertUsable).toHaveBeenCalledWith('abcd-efgh-jklm-npqr', {
        email: 'user@example.com',
      });
      expect(result.secret).toBe('SECRET');
      expect(
        jwt.verify(result.registrationToken, { secret: REGISTRATION_SECRET }),
      ).toMatchObject({
        sub: uuidOf(1),
        login: 'user@example.com',
        inviteCode: 'ABCDEFGHJKLMNPQR',
        type: TokenType.Registration,
      });
    });

    it('registers an account invited by telegram username', async () => {
      invites.assertUsable.mockResolvedValue({
        code: 'ABCDEFGHJKLMNPQR',
        role: Role.Merchant,
      });
      userEnrolment.startRegistration.mockResolvedValue({
        user: telegramUser,
        secret: 'SECRET',
        otpauthUrl: 'otpauth://totp/Paybull:durov?secret=SECRET',
      });

      const result = await service.register({
        login: '@Durov',
        password: 'password123',
        inviteCode: 'ABCDEFGHJKLMNPQR',
      });

      expect(invites.assertUsable).toHaveBeenCalledWith('ABCDEFGHJKLMNPQR', {
        telegramUsername: 'durov',
      });
      expect(
        jwt.verify(result.registrationToken, { secret: REGISTRATION_SECRET }),
      ).toMatchObject({ sub: uuidOf(2), login: 'durov' });
    });

    it('takes the role from the invite, not from the request', async () => {
      invites.assertUsable.mockResolvedValue({
        code: 'ABCDEFGHJKLMNPQR',
        role: Role.LeadTrader,
      });
      userEnrolment.startRegistration.mockResolvedValue({
        user: activeUser,
        secret: 'SECRET',
        otpauthUrl: 'otpauth://totp/Paybull:user@example.com?secret=SECRET',
      });

      await service.register({
        login: 'user@example.com',
        password: 'password123',
        inviteCode: 'ABCDEFGHJKLMNPQR',
      });

      expect(userEnrolment.startRegistration).toHaveBeenCalledWith({
        identifier: { email: 'user@example.com' },
        role: Role.LeadTrader,
        password: 'password123',
      });
    });

    it('renders the QR code from the otpauth URL it returns', async () => {
      invites.assertUsable.mockResolvedValue({
        code: 'ABCDEFGHJKLMNPQR',
        role: Role.Trader,
      });
      userEnrolment.startRegistration.mockResolvedValue({
        user: activeUser,
        secret: 'SECRET',
        otpauthUrl: 'otpauth://totp/Paybull:user@example.com?secret=SECRET',
      });

      const result = await service.register({
        login: 'user@example.com',
        password: 'password123',
        inviteCode: 'ABCDEFGHJKLMNPQR',
      });

      expect(result.qrCode).toBe(await renderQrCodeDataUrl(result.otpauthUrl));
      expect(result.qrCode).not.toBe(await renderQrCodeDataUrl(result.secret));
    });

    it('does not touch the user when the invite is unusable', async () => {
      invites.assertUsable.mockRejectedValue(new Error('invalid'));

      await expect(
        service.register({
          login: 'user@example.com',
          password: 'password123',
          inviteCode: 'NOPE',
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(userEnrolment.startRegistration).not.toHaveBeenCalled();
    });
  });

  describe('confirmRegistration', () => {
    const validToken = (login = 'user@example.com') =>
      registrationToken({
        sub: uuidOf(1),
        login,
        inviteCode: 'ABCDEFGHJKLMNPQR',
        type: TokenType.Registration,
      });

    it('burns the invite, returns backup codes and opens a session', async () => {
      invites.assertUsable.mockResolvedValue({ code: 'ABCDEFGHJKLMNPQR' });
      userEnrolment.confirmTwoFactor.mockResolvedValue(['AAAAA-BBBBB']);
      userDirectory.findAuthenticatableById.mockResolvedValue(activeUser);

      const result = await service.confirmRegistration({
        registrationToken: validToken(),
        totp: '123456',
      });

      expect(userEnrolment.confirmTwoFactor).toHaveBeenCalledWith(
        uuidOf(1),
        '123456',
      );
      expect(invites.consume).toHaveBeenCalledWith(
        'ABCDEFGHJKLMNPQR',
        { email: 'user@example.com' },
        uuidOf(1),
      );
      expect(result.backupCodes).toEqual(['AAAAA-BBBBB']);
      expect(
        jwt.verify(result.session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({
        sub: uuidOf(1),
        login: 'user@example.com',
        role: Role.Trader,
        type: TokenType.Access,
      });
    });

    it('rebuilds a telegram identifier from the registration token', async () => {
      invites.assertUsable.mockResolvedValue({ code: 'ABCDEFGHJKLMNPQR' });
      userEnrolment.confirmTwoFactor.mockResolvedValue(['AAAAA-BBBBB']);
      userDirectory.findAuthenticatableById.mockResolvedValue(telegramUser);

      const result = await service.confirmRegistration({
        registrationToken: validToken('durov'),
        totp: '123456',
      });

      expect(invites.consume).toHaveBeenCalledWith(
        'ABCDEFGHJKLMNPQR',
        { telegramUsername: 'durov' },
        uuidOf(1),
      );
      expect(
        jwt.verify(result.session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({ sub: uuidOf(2), login: 'durov', role: Role.Merchant });
    });

    it('keeps the invite when the one-time code is wrong', async () => {
      invites.assertUsable.mockResolvedValue({ code: 'ABCDEFGHJKLMNPQR' });
      userEnrolment.confirmTwoFactor.mockRejectedValue(
        new UnauthorizedException(),
      );

      await expect(
        service.confirmRegistration({
          registrationToken: validToken(),
          totp: '000000',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(invites.consume).not.toHaveBeenCalled();
    });

    it('rejects a token signed with another secret', async () => {
      const foreign = jwt.sign(
        { sub: uuidOf(1), type: TokenType.Registration },
        { secret: ACCESS_SECRET },
      );

      await expect(
        service.confirmRegistration({
          registrationToken: foreign,
          totp: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token of another type', async () => {
      const wrongType = jwt.sign(
        { sub: uuidOf(1), type: TokenType.Access },
        { secret: REGISTRATION_SECRET },
      );

      await expect(
        service.confirmRegistration({
          registrationToken: wrongType,
          totp: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('two-factor re-enrolment', () => {
    const pendingUser = {
      id: uuidOf(4),
      email: 'reset@example.com',
      telegramUsername: null,
      role: Role.Merchant,
      status: UserStatus.PendingTwoFactor,
    } as User;

    const reEnrolledUser = {
      ...pendingUser,
      status: UserStatus.Active,
    } as User;

    const credentials = {
      login: 'reset@example.com',
      password: 'password123',
    };

    const rejectionOfSetup = (): Promise<Error> =>
      service.startTwoFactorSetup(credentials).then(
        () => {
          throw new Error('expected the setup to be rejected');
        },
        (error: Error) => error,
      );

    it('turns a proven password into an active session with backup codes', async () => {
      userDirectory.findByLogin.mockResolvedValue(pendingUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userEnrolment.startTwoFactorSetup.mockResolvedValue({
        user: pendingUser,
        secret: 'NEWSECRET',
        otpauthUrl: 'otpauth://totp/Paybull:reset@example.com?secret=NEWSECRET',
      });
      userEnrolment.confirmTwoFactor.mockResolvedValue(['AAAAA-BBBBB']);
      userDirectory.findAuthenticatableById.mockResolvedValue(reEnrolledUser);

      const started = await service.startTwoFactorSetup(credentials);

      expect(userEnrolment.startTwoFactorSetup).toHaveBeenCalledWith(uuidOf(4));
      expect(started.secret).toBe('NEWSECRET');
      expect(started.expiresIn).toBe(ENV.JWT_REGISTRATION_TTL_SECONDS);
      expect(
        jwt.verify(started.setupToken, { secret: REGISTRATION_SECRET }),
      ).toMatchObject({
        sub: uuidOf(4),
        login: 'reset@example.com',
        type: TokenType.TwoFactorSetup,
      });

      const completed = await service.confirmTwoFactorSetup({
        setupToken: started.setupToken,
        totp: '123456',
      });

      expect(userEnrolment.confirmTwoFactor).toHaveBeenCalledWith(
        uuidOf(4),
        '123456',
      );
      expect(completed.backupCodes).toEqual(['AAAAA-BBBBB']);
      expect(
        jwt.verify(completed.session.accessToken, { secret: ACCESS_SECRET }),
      ).toMatchObject({
        sub: uuidOf(4),
        login: 'reset@example.com',
        role: Role.Merchant,
        type: TokenType.Access,
      });
      expect(refreshTokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuidOf(4),
          tokenHash: sha256Hex(completed.session.refreshToken),
        }),
      );
    });

    it('needs no invite', async () => {
      userDirectory.findByLogin.mockResolvedValue(pendingUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userEnrolment.startTwoFactorSetup.mockResolvedValue({
        user: pendingUser,
        secret: 'NEWSECRET',
        otpauthUrl: 'otpauth://totp/Paybull:reset@example.com?secret=NEWSECRET',
      });
      userEnrolment.confirmTwoFactor.mockResolvedValue(['AAAAA-BBBBB']);
      userDirectory.findAuthenticatableById.mockResolvedValue(reEnrolledUser);

      const started = await service.startTwoFactorSetup(credentials);
      await service.confirmTwoFactorSetup({
        setupToken: started.setupToken,
        totp: '123456',
      });

      expect(invites.assertUsable).not.toHaveBeenCalled();
      expect(invites.consume).not.toHaveBeenCalled();
    });

    it('renders the QR code from the fresh otpauth URL it returns', async () => {
      userDirectory.findByLogin.mockResolvedValue(pendingUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userEnrolment.startTwoFactorSetup.mockResolvedValue({
        user: pendingUser,
        secret: 'NEWSECRET',
        otpauthUrl: 'otpauth://totp/Paybull:reset@example.com?secret=NEWSECRET',
      });

      const started = await service.startTwoFactorSetup(credentials);

      expect(started.qrCode).toBe(
        await renderQrCodeDataUrl(started.otpauthUrl),
      );
      expect(started.qrCode).not.toBe(
        await renderQrCodeDataUrl(started.secret),
      );
    });

    it('answers an unknown login, a wrong password and an active account alike', async () => {
      userDirectory.findByLogin.mockResolvedValue(null);
      const unknownLogin = await rejectionOfSetup();

      userDirectory.findByLogin.mockResolvedValue(pendingUser);
      userCredentials.verifyPassword.mockResolvedValue(false);
      const wrongPassword = await rejectionOfSetup();

      userDirectory.findByLogin.mockResolvedValue(activeUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      const alreadyActive = await rejectionOfSetup();

      const rejections = [unknownLogin, wrongPassword, alreadyActive];

      rejections.forEach((rejection) =>
        expect(rejection).toBeInstanceOf(UnauthorizedException),
      );
      expect(
        new Set(rejections.map((rejection) => rejection.message)).size,
      ).toBe(1);
      expect(userEnrolment.startTwoFactorSetup).not.toHaveBeenCalled();
    });

    it('rejects a registration token', async () => {
      const foreign = registrationToken({
        sub: uuidOf(1),
        login: 'user@example.com',
        inviteCode: 'ABCDEFGHJKLMNPQR',
        type: TokenType.Registration,
      });

      await expect(
        service.confirmTwoFactorSetup({ setupToken: foreign, totp: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userEnrolment.confirmTwoFactor).not.toHaveBeenCalled();
    });

    it('mints a token that the registration confirmation refuses', async () => {
      userDirectory.findByLogin.mockResolvedValue(pendingUser);
      userCredentials.verifyPassword.mockResolvedValue(true);
      userEnrolment.startTwoFactorSetup.mockResolvedValue({
        user: pendingUser,
        secret: 'NEWSECRET',
        otpauthUrl: 'otpauth://totp/Paybull:reset@example.com?secret=NEWSECRET',
      });

      const started = await service.startTwoFactorSetup(credentials);

      await expect(
        service.confirmRegistration({
          registrationToken: started.setupToken,
          totp: '123456',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(userEnrolment.confirmTwoFactor).not.toHaveBeenCalled();
    });
  });
});
