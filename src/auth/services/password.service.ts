import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { AccountMailService } from '../../mail/services/account-mail.service';
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

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    @InjectRepository(PasswordReset)
    private readonly passwordResets: Repository<PasswordReset>,
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

    await this.administration.update(userId, { password: dto.newPassword });
    await this.sessions.revokeAllSessions(userId);

    return this.sessions.issueSession(user);
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

    console.log('forgotPassword code', code);

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
      reset.failedAttempts += 1;
      await this.passwordResets.save(reset);

      throw new BadRequestException(RESET_REJECTED);
    }

    reset.usedAt = new Date();
    await this.passwordResets.save(reset);

    await this.administration.update(reset.userId, {
      password: dto.newPassword,
    });
    await this.sessions.revokeAllSessions(reset.userId);
  }
}
