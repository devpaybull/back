import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserChanges } from '../types/user-changes';
import { UserStatus } from '../types/user-status.enum';
import { requestedIdentifier } from '../utils/requested-identifier';
import { UserCredentialsService } from './user-credentials.service';
import {
  IDENTIFIER_TAKEN,
  TELEGRAM_ID_TAKEN,
  UserDirectoryService,
} from './user-directory.service';

const UNIQUE_VIOLATION = '23505';
const UNIQUE_VIOLATION_KEY = /^Key \("?([^")]+)"?\)=/;

const CONFLICT_BY_COLUMN: ReadonlyMap<string, string> = new Map([
  ['telegramId', TELEGRAM_ID_TAKEN],
  ['email', IDENTIFIER_TAKEN],
  ['telegramUsername', IDENTIFIER_TAKEN],
]);

const conflictOf = (error: unknown): string | undefined => {
  if (!(error instanceof QueryFailedError)) return undefined;

  const driverError = error.driverError as { code?: string; detail?: string };

  if (driverError.code !== UNIQUE_VIOLATION) return undefined;

  const column = UNIQUE_VIOLATION_KEY.exec(driverError.detail ?? '')?.[1];

  return column === undefined ? undefined : CONFLICT_BY_COLUMN.get(column);
};

@Injectable()
export class UserAdministrationService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
  ) {}

  async update(
    userId: string,
    changes: UserChanges,
    manager?: EntityManager,
  ): Promise<User> {
    const user = await this.directory.requireById(userId);

    if (changes.status === UserStatus.PendingTwoFactor) {
      throw new BadRequestException(
        'Registration status cannot be assigned to a user',
      );
    }

    const identifier = requestedIdentifier(changes);

    if (identifier.email) {
      await this.directory.assertHeldByNobodyElse(userId, {
        email: identifier.email,
      });
    }

    if (identifier.telegramUsername) {
      await this.directory.assertHeldByNobodyElse(userId, {
        telegramUsername: identifier.telegramUsername,
      });
    }

    if (changes.telegramId) {
      await this.directory.assertTelegramIdHeldByNobodyElse(
        userId,
        changes.telegramId,
      );
    }

    const repository = manager ? manager.getRepository(User) : this.users;

    const saved = repository.save(
      repository.merge(user, {
        ...identifier,
        ...(identifier.email ? { emailVerified: false } : {}),
        ...(changes.role !== undefined ? { role: changes.role } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.telegramId !== undefined
          ? { telegramId: changes.telegramId }
          : {}),
        ...(changes.telegramGroups !== undefined
          ? { telegramGroups: changes.telegramGroups || null }
          : {}),
        ...(changes.password !== undefined
          ? {
              passwordHash: await this.credentials.hashPassword(
                changes.password,
              ),
              passwordChangedAt: new Date(),
            }
          : {}),
      }),
    );

    return saved.catch((error: unknown) => {
      const conflict = conflictOf(error);

      if (conflict) throw new ConflictException(conflict);

      throw error;
    });
  }
}
