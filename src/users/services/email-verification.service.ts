import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { AccountMailService } from '../../mail/services/account-mail.service';
import { EmailVerification } from '../entities/email-verification.entity';
import { User } from '../entities/user.entity';
import { UserDirectoryService } from './user-directory.service';

export const EMAIL_VERIFICATION_DENIED =
  'Confirmation code is invalid or expired';

const CODE_LENGTH = 6;
const CODE_EXCLUSIVE_MAX = 1000000;
const MAX_FAILED_ATTEMPTS = 5;
const SECOND_IN_MS = 1000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(EmailVerification)
    private readonly verifications: Repository<EmailVerification>,
    private readonly directory: UserDirectoryService,
    private readonly mail: AccountMailService,
    private readonly config: ConfigService,
  ) {}

  async issueFor(userId: string, email: string): Promise<void> {
    await this.verifications.delete({ userId });

    const code = String(randomInt(CODE_EXCLUSIVE_MAX)).padStart(
      CODE_LENGTH,
      '0',
    );
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('EMAIL_CONFIRMATION_TTL_SECONDS') *
          SECOND_IN_MS,
    );

    await this.verifications.save(
      this.verifications.create({
        userId,
        email,
        codeHash: sha256Hex(code),
        failedAttempts: 0,
        expiresAt,
      }),
    );

    await this.deliver({ to: email, code, expiresAt });
  }

  async confirm(userId: string, code: string): Promise<User> {
    const user = await this.directory.requireById(userId);
    const pending = await this.verifications.findOne({ where: { userId } });

    if (!pending || pending.expiresAt <= new Date()) {
      throw new UnauthorizedException(EMAIL_VERIFICATION_DENIED);
    }

    const stored = Buffer.from(pending.codeHash ?? '', 'hex');
    const offered = Buffer.from(sha256Hex(code), 'hex');

    if (stored.length !== offered.length || !timingSafeEqual(stored, offered)) {
      pending.failedAttempts += 1;

      if (pending.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        await this.verifications.delete({ id: pending.id });
      } else {
        await this.verifications.save(pending);
      }

      throw new UnauthorizedException(EMAIL_VERIFICATION_DENIED);
    }

    if (pending.email !== user.email) {
      throw new UnauthorizedException(EMAIL_VERIFICATION_DENIED);
    }

    const verified = await this.users.save(
      this.users.merge(user, { emailVerified: true }),
    );

    await this.verifications.delete({ id: pending.id });

    return verified;
  }

  private async deliver(message: {
    to: string;
    code: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      const sent = await this.mail.sendEmailConfirmationCode(message);

      if (!sent) {
        this.logger.warn(
          `Confirmation code for ${message.to} was not delivered — outgoing mail is disabled`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Confirmation code for ${message.to} could not be emailed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
