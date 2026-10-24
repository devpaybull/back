import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { generateSecret, generateURI } from 'otplib';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { RegistrationInput } from '../types/registration-input';
import { StartedRegistration } from '../types/started-registration';
import { UserStatus } from '../types/user-status.enum';
import { normalizeIdentifier } from '../utils/normalize-identifier';
import { UserCredentialsService } from './user-credentials.service';
import {
  IDENTIFIER_TAKEN,
  UserDirectoryService,
} from './user-directory.service';

const TWO_FACTOR_ALREADY_SET_UP = 'Two-factor authentication is already set up';

@Injectable()
export class UserEnrolmentService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
    private readonly config: ConfigService,
  ) {}

  async startRegistration(
    input: RegistrationInput,
  ): Promise<StartedRegistration> {
    const identifier = normalizeIdentifier(input.identifier);
    const existing = await this.directory.findByIdentifier(identifier);

    if (existing && existing.status !== UserStatus.PendingTwoFactor) {
      throw new ConflictException(IDENTIFIER_TAKEN);
    }

    const secret = generateSecret();

    const user = await this.users.save(
      this.users.merge(existing ?? this.users.create(), {
        email: identifier.email ?? null,
        emailVerified: Boolean(identifier.email),
        telegramUsername: identifier.telegramUsername ?? null,
        role: input.role,
        merchantId: input.merchantId ?? null,
        passwordHash: await this.credentials.hashPassword(input.password),
        totpSecret: secret,
        status: UserStatus.PendingTwoFactor,
        twoFactorConfirmedAt: null,
      }),
    );

    await this.credentials.discardBackupCodes(user.id);

    return {
      user,
      secret,
      otpauthUrl: generateURI({
        issuer: this.config.get<string>('TOTP_ISSUER'),
        label: identifier.email ?? identifier.telegramUsername,
        secret,
      }),
    };
  }

  async confirmTwoFactor(userId: string, totp: string): Promise<string[]> {
    const user = await this.directory.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Registration is no longer valid');
    }

    if (user.status !== UserStatus.PendingTwoFactor) {
      throw new ConflictException(TWO_FACTOR_ALREADY_SET_UP);
    }

    if (!(await this.credentials.verifyTotp(user, totp))) {
      throw new UnauthorizedException('Invalid one-time code');
    }

    user.status = UserStatus.Active;
    user.twoFactorConfirmedAt = new Date();
    await this.users.save(user);

    return this.credentials.issueBackupCodes(user.id);
  }

  async attachMerchant(
    userId: string,
    merchantId: string,
    manager?: EntityManager,
  ): Promise<User> {
    const user = await this.directory.requireById(userId);
    const repository = manager ? manager.getRepository(User) : this.users;

    return repository.save(repository.merge(user, { merchantId }));
  }

  async resetTwoFactor(userId: string): Promise<User> {
    const user = await this.directory.requireById(userId);

    await this.credentials.discardBackupCodes(user.id);

    return this.users.save(
      this.users.merge(user, {
        status: UserStatus.PendingTwoFactor,
        twoFactorConfirmedAt: null,
        totpSecret: generateSecret(),
      }),
    );
  }

  async startTwoFactorSetup(userId: string): Promise<StartedRegistration> {
    const user = await this.directory.requireById(userId);

    if (user.status !== UserStatus.PendingTwoFactor) {
      throw new ConflictException(TWO_FACTOR_ALREADY_SET_UP);
    }

    const secret = generateSecret();
    const saved = await this.users.save(
      this.users.merge(user, { totpSecret: secret }),
    );

    return {
      user: saved,
      secret,
      otpauthUrl: generateURI({
        issuer: this.config.get<string>('TOTP_ISSUER'),
        label: saved.email ?? saved.telegramUsername,
        secret,
      }),
    };
  }
}
