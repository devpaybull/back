import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { OwnIdentifierChanges } from '../types/own-identifier-changes';
import { requestedIdentifier } from '../utils/requested-identifier';
import { EmailVerificationService } from './email-verification.service';
import { UserDirectoryService } from './user-directory.service';

export const EMAIL_ALREADY_CONFIRMED =
  'This account already has a confirmed email: a confirmed email can only be changed by an administrator';

export const TELEGRAM_USERNAME_ALREADY_SET =
  'This account already has a telegram username: a telegram username can only be added, never changed — ask an administrator to change it';

@Injectable()
export class UserProfileService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly directory: UserDirectoryService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async editOwnIdentifiers(
    userId: string,
    changes: OwnIdentifierChanges,
  ): Promise<User> {
    const user = await this.directory.requireById(userId);
    const requested = requestedIdentifier(changes);

    if (requested.telegramUsername) {
      if (user.telegramUsername) {
        throw new ConflictException(TELEGRAM_USERNAME_ALREADY_SET);
      }

      await this.directory.assertHeldByNobodyElse(userId, {
        telegramUsername: requested.telegramUsername,
      });
    }

    if (requested.email) {
      if (user.emailVerified) {
        throw new ConflictException(EMAIL_ALREADY_CONFIRMED);
      }

      await this.directory.assertHeldByNobodyElse(userId, {
        email: requested.email,
      });
    }

    if (!requested.email && !requested.telegramUsername) return user;

    const edited = await this.users.save(
      this.users.merge(user, {
        ...requested,
        ...(requested.email ? { emailVerified: false } : {}),
      }),
    );

    if (requested.email) {
      await this.emailVerification.issueFor(edited.id, requested.email);
    }

    return edited;
  }
}
