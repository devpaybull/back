import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { generate, generateSecret } from 'otplib';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { UserBackupCode } from '../entities/user-backup-code.entity';
import { User } from '../entities/user.entity';
import { UserCredentialsService } from '../services/user-credentials.service';
import { UserDirectoryService } from '../services/user-directory.service';
import { UserEnrolmentService } from '../services/user-enrolment.service';
import { UserStatus } from '../types/user-status.enum';
import { createFakeRepository, FakeRepository } from './fake-repository.spec';

describe('UserEnrolmentService', () => {
  const env: Record<string, unknown> = { TOTP_ISSUER: 'Paybull' };

  let stored: Partial<User>[];
  let storedCodes: Partial<UserBackupCode>[];
  let users: FakeRepository;
  let backupCodes: FakeRepository;
  let service: UserEnrolmentService;

  beforeEach(async () => {
    stored = [];
    storedCodes = [];
    users = createFakeRepository(stored);
    backupCodes = createFakeRepository(storedCodes);

    const module = await Test.createTestingModule({
      providers: [
        UserEnrolmentService,
        UserDirectoryService,
        UserCredentialsService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(UserBackupCode), useValue: backupCodes },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();

    service = module.get(UserEnrolmentService);
  });

  describe('startRegistration', () => {
    it('rejects an email that already belongs to an active user', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Active });

      await expect(
        service.startRegistration({
          identifier: { email: 'User@Example.com' },
          role: Role.Trader,
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a telegram username that already belongs to an active user', async () => {
      stored.push({ telegramUsername: 'durov', status: UserStatus.Active });

      await expect(
        service.startRegistration({
          identifier: { telegramUsername: '@Durov' },
          role: Role.Trader,
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an email that already belongs to a blocked user', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Blocked });

      await expect(
        service.startRegistration({
          identifier: { email: 'user@example.com' },
          role: Role.Trader,
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects an email that already belongs to a suspended user', async () => {
      stored.push({ email: 'user@example.com', status: UserStatus.Suspended });

      await expect(
        service.startRegistration({
          identifier: { email: 'user@example.com' },
          role: Role.Trader,
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('leaves an email an admin added to a pending account alone', async () => {
      stored.push({
        id: uuidOf(1),
        telegramUsername: 'durov',
        email: 'added@example.com',
        status: UserStatus.PendingTwoFactor,
      });

      const result = await service.startRegistration({
        identifier: { telegramUsername: 'durov' },
        role: Role.Trader,
        password: 'password123',
      });

      expect(result.user.id).toBe(uuidOf(1));
      expect(result.user.email).toBe('added@example.com');
      expect(stored[0].email).toBe('added@example.com');
    });

    it('never starts an account with a verified email', async () => {
      const result = await service.startRegistration({
        identifier: { email: 'user@example.com' },
        role: Role.Merchant,
        password: 'password123',
      });

      expect(result.user.emailVerified).toBe(false);
    });

    it('creates a pending user from a telegram invite', async () => {
      const result = await service.startRegistration({
        identifier: { telegramUsername: ' @Durov ' },
        role: Role.Cascade,
        password: 'password123',
      });

      expect(result.user.telegramUsername).toBe('durov');
      expect(result.user.email).toBeFalsy();
      expect(result.user.status).toBe(UserStatus.PendingTwoFactor);
      expect(decodeURIComponent(result.otpauthUrl)).toContain('durov');
    });

    it('leaves a telegram invite with nothing to have proved', async () => {
      const result = await service.startRegistration({
        identifier: { telegramUsername: 'durov' },
        role: Role.Cascade,
        password: 'password123',
      });

      expect(result.user.emailVerified).toBe(false);
    });

    it('writes the role the invite was issued for', async () => {
      const merchantSupport = await service.startRegistration({
        identifier: { email: 'support@example.com' },
        role: Role.MerchantSupport,
        password: 'password123',
      });
      const leadTrader = await service.startRegistration({
        identifier: { telegramUsername: 'lead' },
        role: Role.LeadTrader,
        password: 'password123',
      });

      expect(merchantSupport.user.role).toBe(Role.MerchantSupport);
      expect(leadTrader.user.role).toBe(Role.LeadTrader);
    });

    it('replaces the secret of a user who never finished registration', async () => {
      stored.push({
        id: uuidOf(1),
        email: 'user@example.com',
        status: UserStatus.PendingTwoFactor,
        totpSecret: 'OLDSECRET',
      });

      const result = await service.startRegistration({
        identifier: { email: 'user@example.com' },
        role: Role.Trader,
        password: 'password123',
      });

      expect(result.secret).not.toBe('OLDSECRET');
      expect(result.user.status).toBe(UserStatus.PendingTwoFactor);
      expect(backupCodes.delete).toHaveBeenCalledWith({ userId: uuidOf(1) });
    });

    it('overwrites a pending telegram registration in place', async () => {
      stored.push({
        id: uuidOf(1),
        telegramUsername: 'durov',
        status: UserStatus.PendingTwoFactor,
        totpSecret: 'OLDSECRET',
        role: Role.Trader,
      });

      const result = await service.startRegistration({
        identifier: { telegramUsername: 'durov' },
        role: Role.MerchantAgent,
        password: 'password123',
      });

      expect(result.user.id).toBe(uuidOf(1));
      expect(result.user.role).toBe(Role.MerchantAgent);
      expect(result.secret).not.toBe('OLDSECRET');
      expect(backupCodes.delete).toHaveBeenCalledWith({ userId: uuidOf(1) });
    });
  });

  describe('confirmTwoFactor', () => {
    const secret = generateSecret();

    const pendingUser = (): User =>
      ({
        id: uuidOf(1),
        email: 'user@example.com',
        status: UserStatus.PendingTwoFactor,
        totpSecret: secret,
      }) as User;

    it('rejects a wrong one-time code', async () => {
      stored.push(pendingUser());

      await expect(
        service.confirmTwoFactor(uuidOf(1), '000000'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('activates the user and issues ten backup codes', async () => {
      const user = pendingUser();
      stored.push(user);

      const codes = await service.confirmTwoFactor(
        uuidOf(1),
        await generate({ secret }),
      );

      expect(user.status).toBe(UserStatus.Active);
      expect(user.twoFactorConfirmedAt).toBeInstanceOf(Date);
      expect(codes).toHaveLength(10);
    });

    it('refuses to run twice for the same user', async () => {
      stored.push({ ...pendingUser(), status: UserStatus.Active });

      await expect(
        service.confirmTwoFactor(uuidOf(1), await generate({ secret })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to activate a blocked user', async () => {
      stored.push({ ...pendingUser(), status: UserStatus.Blocked });

      await expect(
        service.confirmTwoFactor(uuidOf(1), await generate({ secret })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses an account that is no longer there', async () => {
      await expect(
        service.confirmTwoFactor(uuidOf(404), await generate({ secret })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('the merchant an account works for', () => {
    it('takes the merchant the invite carried', async () => {
      const result = await service.startRegistration({
        identifier: { email: 'support@example.com' },
        role: Role.MerchantSupport,
        password: 'password123',
        merchantId: uuidOf(50),
      });

      expect(result.user.merchantId).toBe(uuidOf(50));
    });

    it('leaves the merchant empty when the invite carried none', async () => {
      const result = await service.startRegistration({
        identifier: { email: 'trader@example.com' },
        role: Role.Trader,
        password: 'password123',
      });

      expect(result.user.merchantId).toBeNull();
    });

    it('binds an existing account to a merchant', async () => {
      stored.push({ id: uuidOf(1), role: Role.Merchant, merchantId: null });

      const attached = await service.attachMerchant(uuidOf(1), uuidOf(50));

      expect(attached.merchantId).toBe(uuidOf(50));
      expect(stored[0].merchantId).toBe(uuidOf(50));
    });

    it('writes through the given transaction when one is passed', async () => {
      stored.push({ id: uuidOf(1), role: Role.Merchant, merchantId: null });
      const inTransaction = {
        merge: jest.fn((user, changes) => ({ ...user, ...changes })),
        save: jest.fn(async (user) => user),
      };
      const manager = { getRepository: jest.fn(() => inTransaction) };

      const attached = await service.attachMerchant(
        uuidOf(1),
        uuidOf(50),
        manager as never,
      );

      expect(attached.merchantId).toBe(uuidOf(50));
      expect(inTransaction.save).toHaveBeenCalledTimes(1);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses to bind an account that is not there', async () => {
      await expect(
        service.attachMerchant(uuidOf(404), uuidOf(50)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(users.save).not.toHaveBeenCalled();
    });
  });

  describe('resetTwoFactor', () => {
    const confirmedUser = (): Partial<User> => ({
      id: uuidOf(1),
      email: 'user@example.com',
      status: UserStatus.Active,
      totpSecret: 'OLDSECRET',
      twoFactorConfirmedAt: new Date(),
    });

    it('rejects an unknown user', async () => {
      await expect(service.resetTwoFactor(uuidOf(404))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(users.save).not.toHaveBeenCalled();
    });

    it('sends the user back to the registration status', async () => {
      stored.push(confirmedUser());

      await expect(service.resetTwoFactor(uuidOf(1))).resolves.toMatchObject({
        status: UserStatus.PendingTwoFactor,
        twoFactorConfirmedAt: null,
      });
    });

    it('deletes every backup code', async () => {
      stored.push(confirmedUser());

      await service.resetTwoFactor(uuidOf(1));

      expect(backupCodes.delete).toHaveBeenCalledWith({ userId: uuidOf(1) });
    });

    it('replaces the secret, so the installed authenticator stops working', async () => {
      stored.push(confirmedUser());

      const reset = await service.resetTwoFactor(uuidOf(1));

      expect(reset.totpSecret).not.toBe('OLDSECRET');
      expect(reset.totpSecret).toEqual(expect.any(String));
    });

    it('stamps twoFactorResetAt, which the withdrawal hold reads', async () => {
      stored.push(confirmedUser());
      const before = Date.now();

      const reset = await service.resetTwoFactor(uuidOf(1));

      expect(reset.twoFactorResetAt).toBeInstanceOf(Date);
      expect(reset.twoFactorResetAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('reaches a blocked user', async () => {
      stored.push({ ...confirmedUser(), status: UserStatus.Blocked });

      await expect(service.resetTwoFactor(uuidOf(1))).resolves.toMatchObject({
        status: UserStatus.PendingTwoFactor,
      });
    });
  });

  describe('startTwoFactorSetup', () => {
    const pendingUser = (patch: Partial<User> = {}): Partial<User> => ({
      id: uuidOf(1),
      email: 'user@example.com',
      status: UserStatus.PendingTwoFactor,
      totpSecret: 'OLDSECRET',
      ...patch,
    });

    it('rejects an unknown user', async () => {
      await expect(
        service.startTwoFactorSetup(uuidOf(404)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an active user', async () => {
      stored.push(pendingUser({ status: UserStatus.Active }));

      await expect(
        service.startTwoFactorSetup(uuidOf(1)),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses a suspended user', async () => {
      stored.push(pendingUser({ status: UserStatus.Suspended }));

      await expect(
        service.startTwoFactorSetup(uuidOf(1)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a blocked user', async () => {
      stored.push(pendingUser({ status: UserStatus.Blocked }));

      await expect(
        service.startTwoFactorSetup(uuidOf(1)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('saves a fresh secret and returns a scannable url', async () => {
      const user = pendingUser();
      stored.push(user);

      const started = await service.startTwoFactorSetup(uuidOf(1));

      expect(started.secret).not.toBe('OLDSECRET');
      expect(user.totpSecret).toBe(started.secret);
      expect(started.otpauthUrl).toContain(`secret=${started.secret}`);
      expect(started.otpauthUrl).toContain('issuer=Paybull');
      expect(decodeURIComponent(started.otpauthUrl)).toContain(
        'user@example.com',
      );
    });

    it('labels the url with the telegram username when there is no email', async () => {
      stored.push(pendingUser({ email: null, telegramUsername: 'durov' }));

      const started = await service.startTwoFactorSetup(uuidOf(1));

      expect(decodeURIComponent(started.otpauthUrl)).toContain('durov');
    });

    it('labels the secret with the telegram username when the user holds both identifiers', async () => {
      stored.push(pendingUser({ telegramUsername: 'durov' }));

      const started = await service.startTwoFactorSetup(uuidOf(1));

      expect(decodeURIComponent(started.otpauthUrl)).toContain('durov');
      expect(decodeURIComponent(started.otpauthUrl)).not.toContain(
        'user@example.com',
      );
    });

    it('hands the user over to confirmTwoFactor', async () => {
      stored.push(pendingUser());

      const started = await service.startTwoFactorSetup(uuidOf(1));
      const codes = await service.confirmTwoFactor(
        uuidOf(1),
        await generate({ secret: started.secret }),
      );

      expect(codes).toHaveLength(10);
      expect(stored[0].status).toBe(UserStatus.Active);
    });
  });
});
