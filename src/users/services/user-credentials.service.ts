import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { verify } from 'otplib';
import { IsNull, Repository } from 'typeorm';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { UserBackupCode } from '../entities/user-backup-code.entity';
import { User } from '../entities/user.entity';
import { OneTimeCodeCheck } from '../types/one-time-code-check';
import { OneTimeCodeLimits } from '../types/one-time-code-limits';
import { SecondFactor } from '../types/second-factor';
import { normalizeCode } from '../utils/normalize-code';

const PASSWORD_HASH_ROUNDS = 12;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5;
const BACKUP_CODE_GROUP_LENGTH = 5;
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

@Injectable()
export class UserCredentialsService {
  constructor(
    @InjectRepository(UserBackupCode)
    private readonly backupCodes: Repository<UserBackupCode>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  hashPassword(password: string): Promise<string> {
    return hash(password, PASSWORD_HASH_ROUNDS);
  }

  verifyPassword(user: User, password: string): Promise<boolean> {
    return compare(password, user.passwordHash);
  }

  private async totpStep(user: User, totp: string): Promise<number | null> {
    try {
      const result = await verify({
        secret: user.totpSecret,
        token: normalizeCode(totp),
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
      });

      return result.valid && 'timeStep' in result ? result.timeStep : null;
    } catch {
      return null;
    }
  }

  async verifyTotp(user: User, totp: string): Promise<boolean> {
    try {
      const result = await verify({
        secret: user.totpSecret,
        token: normalizeCode(totp),
        epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
      });

      return result.valid;
    } catch {
      return false;
    }
  }

  async spendWithdrawalTotp(
    user: User,
    totp: string,
    limits: OneTimeCodeLimits,
    now = new Date(),
  ): Promise<OneTimeCodeCheck> {
    const windowStart = new Date(now.getTime() - limits.windowMinutes * 60_000);
    const failuresCount =
      user.withdrawalTotpFailuresSince &&
      user.withdrawalTotpFailuresSince > windowStart
        ? user.withdrawalTotpFailures
        : 0;

    if (failuresCount >= limits.maxFailures) return 'locked';

    const step = await this.totpStep(user, totp);
    const spent =
      step !== null &&
      (
        await this.users
          .createQueryBuilder()
          .update(User)
          .set({
            withdrawalTotpLastStep: step,
            withdrawalTotpFailures: 0,
            withdrawalTotpFailuresSince: null,
          })
          .where('id = :id', { id: user.id })
          .andWhere(
            '("withdrawalTotpLastStep" IS NULL OR "withdrawalTotpLastStep" < :step)',
            { step },
          )
          .execute()
      ).affected === 1;

    if (spent) return 'accepted';

    await this.users.update(
      { id: user.id },
      failuresCount === 0
        ? { withdrawalTotpFailures: 1, withdrawalTotpFailuresSince: now }
        : { withdrawalTotpFailures: failuresCount + 1 },
    );

    return 'refused';
  }

  async verifySecondFactor(user: User, factor: SecondFactor): Promise<boolean> {
    if (factor.totp) return this.verifyTotp(user, factor.totp);
    if (factor.backupCode)
      return this.consumeBackupCode(user.id, factor.backupCode);

    return false;
  }

  async discardBackupCodes(userId: string): Promise<void> {
    await this.backupCodes.delete({ userId });
  }

  async issueBackupCodes(userId: string): Promise<string[]> {
    await this.discardBackupCodes(userId);

    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(BACKUP_CODE_BYTES).toString('hex').toUpperCase(),
    );

    await this.backupCodes.save(
      codes.map((code) =>
        this.backupCodes.create({ userId, codeHash: sha256Hex(code) }),
      ),
    );

    return codes.map(
      (code) =>
        `${code.slice(0, BACKUP_CODE_GROUP_LENGTH)}-${code.slice(BACKUP_CODE_GROUP_LENGTH)}`,
    );
  }

  private async consumeBackupCode(
    userId: string,
    backupCode: string,
  ): Promise<boolean> {
    const stored = await this.backupCodes.findOne({
      where: {
        userId,
        codeHash: sha256Hex(normalizeCode(backupCode)),
        usedAt: IsNull(),
      },
    });

    if (!stored) return false;

    stored.usedAt = new Date();
    await this.backupCodes.save(stored);

    return true;
  }
}
