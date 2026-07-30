import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { verify } from 'otplib';
import { IsNull, Repository } from 'typeorm';
import { sha256Hex } from '../../common/utils/sha256-hex';
import { UserBackupCode } from '../entities/user-backup-code.entity';
import { User } from '../entities/user.entity';
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
  ) {}

  hashPassword(password: string): Promise<string> {
    return hash(password, PASSWORD_HASH_ROUNDS);
  }

  verifyPassword(user: User, password: string): Promise<boolean> {
    return compare(password, user.passwordHash);
  }

  async verifyTotp(user: User, totp: string): Promise<boolean> {
    const result = await verify({
      secret: user.totpSecret,
      token: normalizeCode(totp),
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });

    return result.valid;
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
