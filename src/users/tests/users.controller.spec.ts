import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { User } from '../entities/user.entity';
import { EmailVerificationService } from '../services/email-verification.service';
import { UserDirectoryService } from '../services/user-directory.service';
import { UserProfileService } from '../services/user-profile.service';
import { UserStatus } from '../types/user-status.enum';
import { UsersController } from '../users.controller';

describe('UsersController', () => {
  const directory = { findAuthenticatableById: jest.fn() };
  const profile = { editOwnIdentifiers: jest.fn() };
  const emailVerification = { confirm: jest.fn() };
  const settings = { ensure: jest.fn() };

  const caller = (overrides: Partial<AuthenticatedUser> = {}) => ({
    id: uuidOf(7),
    login: 'user@example.com',
    role: Role.Trader,
    status: UserStatus.Active,
    ...overrides,
  });

  const user = (overrides: Partial<User> = {}): User =>
    ({
      id: uuidOf(7),
      email: 'user@example.com',
      emailVerified: true,
      telegramUsername: null,
      passwordHash: '$2b$12$notarealhash',
      role: Role.Trader,
      status: UserStatus.Active,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      twoFactorConfirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as User;

  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UserDirectoryService, useValue: directory },
        { provide: UserProfileService, useValue: profile },
        { provide: EmailVerificationService, useValue: emailVerification },
        { provide: TraderSettingsService, useValue: settings },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();

    controller = module.get(UsersController);
  });

  it('leaves the handler unmarked, so a suspended user keeps read access', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        UsersController.prototype.me,
      ),
    ).toBeUndefined();
  });

  it('returns the profile of the signed-in user', async () => {
    directory.findAuthenticatableById.mockResolvedValue(user());

    const result = await controller.me(caller());

    expect(directory.findAuthenticatableById).toHaveBeenCalledWith(uuidOf(7));
    expect(result).toEqual({
      id: uuidOf(7),
      login: 'user@example.com',
      email: 'user@example.com',
      emailVerified: true,
      telegramUsername: null,
      role: Role.Trader,
      status: UserStatus.Active,
      createdAt: expect.any(Date),
    });
  });

  it('reads the row rather than trusting the token', async () => {
    directory.findAuthenticatableById.mockResolvedValue(
      user({ role: Role.Merchant, status: UserStatus.Suspended }),
    );

    const result = await controller.me(
      caller({ role: Role.Trader, status: UserStatus.Active }),
    );

    expect(result.role).toBe(Role.Merchant);
    expect(result.status).toBe(UserStatus.Suspended);
  });

  it('never exposes the password hash or the totp secret', async () => {
    directory.findAuthenticatableById.mockResolvedValue(user());

    const result = await controller.me(caller());

    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('totpSecret');
    expect(JSON.stringify(result)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(JSON.stringify(result)).not.toContain('$2b$12$notarealhash');
  });

  it('exposes exactly the agreed fields', async () => {
    directory.findAuthenticatableById.mockResolvedValue(user());

    const result = await controller.me(caller());

    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerified',
      'id',
      'login',
      'role',
      'status',
      'telegramUsername',
    ]);
  });

  it('falls back to the telegram username as the login', async () => {
    directory.findAuthenticatableById.mockResolvedValue(
      user({ email: null, emailVerified: false, telegramUsername: 'durov' }),
    );

    const result = await controller.me(caller({ login: 'durov' }));

    expect(result.login).toBe('durov');
    expect(result.email).toBeNull();
    expect(result.emailVerified).toBe(false);
    expect(result.telegramUsername).toBe('durov');
  });

  it('prefers the email as the login and still reports both identifiers', async () => {
    directory.findAuthenticatableById.mockResolvedValue(
      user({ email: 'user@example.com', telegramUsername: 'durov' }),
    );

    const result = await controller.me(caller());

    expect(result.login).toBe('user@example.com');
    expect(result.email).toBe('user@example.com');
    expect(result.telegramUsername).toBe('durov');
  });

  it('refuses an account that stopped being authenticatable', async () => {
    directory.findAuthenticatableById.mockResolvedValue(null);

    await expect(controller.me(caller())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  describe('editing the profile', () => {
    const writeHandlers = [
      UsersController.prototype.update,
      UsersController.prototype.confirmEmail,
    ];

    it('marks every identifier write, so a suspended account is refused', () => {
      writeHandlers.forEach((handler) =>
        expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
          true,
        ),
      );
    });

    it('guards the controller with the write-access guard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        UsersController,
      ) as unknown[];

      expect(guards).toContain(WriteAccessGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(WriteAccessGuard),
      );
    });

    it('refuses a body that asks for nothing', async () => {
      await expect(controller.update(caller(), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(profile.editOwnIdentifiers).not.toHaveBeenCalled();
    });

    it('adds a telegram username and answers with the profile', async () => {
      profile.editOwnIdentifiers.mockResolvedValue(
        user({ telegramUsername: 'durov' }),
      );

      const result = await controller.update(caller(), {
        telegramUsername: ' @Durov ',
      });

      expect(profile.editOwnIdentifiers).toHaveBeenCalledWith(uuidOf(7), {
        telegramUsername: ' @Durov ',
      });
      expect(result.telegramUsername).toBe('durov');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('reports the submitted address as written but unconfirmed', async () => {
      profile.editOwnIdentifiers.mockResolvedValue(
        user({ email: 'user@example.com', emailVerified: false }),
      );

      const result = await controller.update(caller({ login: 'durov' }), {
        email: 'user@example.com',
      });

      expect(profile.editOwnIdentifiers).toHaveBeenCalledWith(uuidOf(7), {
        email: 'user@example.com',
      });
      expect(result.email).toBe('user@example.com');
      expect(result.emailVerified).toBe(false);
    });

    it('passes a refusal from the service through untouched', async () => {
      profile.editOwnIdentifiers.mockRejectedValue(
        new ConflictException(
          'This account already has a confirmed email: a confirmed email can only be changed by an administrator',
        ),
      );

      await expect(
        controller.update(caller(), { email: 'second@example.com' }),
      ).rejects.toThrow(/administrator/i);
    });

    it('confirms an address with the code alone and answers with the profile', async () => {
      emailVerification.confirm.mockResolvedValue(
        user({ email: 'user@example.com', emailVerified: true }),
      );

      const result = await controller.confirmEmail(caller(), {
        code: '123456',
      });

      expect(emailVerification.confirm).toHaveBeenCalledWith(
        uuidOf(7),
        '123456',
      );
      expect(result.email).toBe('user@example.com');
      expect(result.emailVerified).toBe(true);
      expect(result).not.toHaveProperty('totpSecret');
    });
  });
});
