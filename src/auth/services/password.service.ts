import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { DataSource, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { RecordAuditEntry } from '../../audit/types/record-audit-entry';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { AccountMailService } from '../../mail/services/account-mail.service';
import { User } from '../../users/entities/user.entity';
import { UserChanges } from '../../users/types/user-changes';
import { UserAdministrationService } from '../../users/services/user-administration.service';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { PasswordReset } from '../entities/password-reset.entity';
import { IssuedSession } from '../types/token-payloads';
import { SessionService } from './session.service';

const MINUTE_IN_MS = 60 * 1000;
const CURRENT_PASSWORD_REJECTED = 'Current password is incorrect';
const RESET_REJECTED = 'Password reset is invalid, used or expired';
const RESET_CODE_LENGTH = 6;
const RESET_CODE_EXCLUSIVE_MAX = 1000000;
const RESET_MAX_FAILED_ATTEMPTS = 5;
const PASSWORD_GENERATED_ACTION = 'user.password_generated';
const PASSWORD_SET_ACTION = 'user.password_set';
const GENERATED_PASSWORD_LENGTH = 12;
const GENERATED_PASSWORD_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    @InjectRepository(PasswordReset)
    private readonly passwordResets: Repository<PasswordReset>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
    private readonly administration: UserAdministrationService,
    private readonly mail: AccountMailService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<IssuedSession> {
    const user = await this.directory.findAuthenticatableById(userId);

    if (
      !user ||
      !(await this.credentials.verifyPassword(user, dto.currentPassword))
    ) {
      throw new UnauthorizedException(CURRENT_PASSWORD_REJECTED);
    }

    await this.replacePassword(userId, { password: dto.newPassword });

    return this.sessions.issueSession(user);
  }

  async issueGeneratedPassword(
    userId: string,
    actorUserId: string,
  ): Promise<string> {
    const password = Array.from(
      { length: GENERATED_PASSWORD_LENGTH },
      () =>
        GENERATED_PASSWORD_ALPHABET[
          randomInt(GENERATED_PASSWORD_ALPHABET.length)
        ],
    ).join('');

    await this.replacePassword(
      userId,
      { password },
      { actorUserId, action: PASSWORD_GENERATED_ACTION },
    );

    return password;
  }

  setPassword(
    userId: string,
    changes: UserChanges,
    actorUserId: string,
  ): Promise<User> {
    return this.replacePassword(userId, changes, {
      actorUserId,
      action: PASSWORD_SET_ACTION,
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.directory.findAuthenticatableByLogin(dto.login);

    if (!user?.email || !user.emailVerified) return;

    await this.passwordResets.delete({ userId: user.id, usedAt: IsNull() });

    const code = String(randomInt(RESET_CODE_EXCLUSIVE_MAX)).padStart(
      RESET_CODE_LENGTH,
      '0',
    );
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('PASSWORD_RESET_TTL_MINUTES') * MINUTE_IN_MS,
    );

    await this.passwordResets.save(
      this.passwordResets.create({
        userId: user.id,
        codeHash: sha256Hex(code),
        failedAttempts: 0,
        expiresAt,
      }),
    );

    try {
      await this.mail.sendPasswordRecoveryCode({
        to: user.email,
        login: user.email,
        code,
        expiresAt,
      });
    } catch (error) {
      this.logger.error(
        `Password reset for ${user.email} was created but could not be emailed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.directory.findAuthenticatableByLogin(dto.login);

    if (!user) {
      throw new BadRequestException(RESET_REJECTED);
    }

    const reset = await this.passwordResets.findOne({
      where: { userId: user.id },
      order: { id: 'DESC' },
    });

    if (
      !reset ||
      reset.usedAt ||
      reset.expiresAt <= new Date() ||
      reset.failedAttempts >= RESET_MAX_FAILED_ATTEMPTS
    ) {
      throw new BadRequestException(RESET_REJECTED);
    }

    if (reset.codeHash !== sha256Hex(dto.code)) {
      await this.passwordResets.increment(
        { id: reset.id, failedAttempts: LessThan(RESET_MAX_FAILED_ATTEMPTS) },
        'failedAttempts',
        1,
      );

      throw new BadRequestException(RESET_REJECTED);
    }

    const now = new Date();
    const { affected } = await this.passwordResets.update(
      {
        id: reset.id,
        usedAt: IsNull(),
        failedAttempts: LessThan(RESET_MAX_FAILED_ATTEMPTS),
        expiresAt: MoreThan(now),
      },
      { usedAt: now },
    );

    if (affected !== 1) {
      throw new BadRequestException(RESET_REJECTED);
    }

    await this.replacePassword(reset.userId, { password: dto.newPassword });
  }

  private replacePassword(
    userId: string,
    changes: UserChanges,
    audited?: Omit<RecordAuditEntry, 'targetUserId'>,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.administration.update(userId, changes, manager);

      await this.sessions.revokeAllSessions(userId, manager);

      if (audited) {
        await this.audit.record({ ...audited, targetUserId: userId }, manager);
      }

      return user;
    });
  }
}
