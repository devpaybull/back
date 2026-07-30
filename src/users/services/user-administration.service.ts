import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserChanges } from '../types/user-changes';
import { UserStatus } from '../types/user-status.enum';
import { requestedIdentifier } from '../utils/requested-identifier';
import { UserCredentialsService } from './user-credentials.service';
import { UserDirectoryService } from './user-directory.service';

@Injectable()
export class UserAdministrationService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly directory: UserDirectoryService,
    private readonly credentials: UserCredentialsService,
  ) {}

  async update(userId: string, changes: UserChanges): Promise<User> {
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

    return this.users.save(
      this.users.merge(user, {
        ...identifier,
        ...(identifier.email ? { emailVerified: false } : {}),
        ...(changes.role !== undefined ? { role: changes.role } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.password !== undefined
          ? {
              passwordHash: await this.credentials.hashPassword(
                changes.password,
              ),
            }
          : {}),
      }),
    );
  }
}
