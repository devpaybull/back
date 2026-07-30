import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { AccountIdentifier } from '../../common/types/account-identifier';
import { Page, toPage } from '../../common/types/page';
import { toAccountIdentifier } from '../../common/utils/to-account-identifier';
import { User } from '../entities/user.entity';
import { UserListQuery } from '../types/user-list-query';
import { UserStatus } from '../types/user-status.enum';
import { identifierMatches } from '../utils/identifier-matches';
import { registeredOnly } from '../utils/registered-only';
import { userListOrder } from '../utils/user-list-order';
import { userListWhere } from '../utils/user-list-where';

export const IDENTIFIER_TAKEN = 'User with this identifier already exists';

const AUTHENTICATABLE_STATUSES = [UserStatus.Active, UserStatus.Suspended];

@Injectable()
export class UserDirectoryService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User> {
    return this.users.findOne({ where: { id } });
  }

  findAuthenticatableById(id: string): Promise<User> {
    return this.users.findOne({
      where: { id, status: In(AUTHENTICATABLE_STATUSES) },
    });
  }

  findByIdentifier(identifier: AccountIdentifier): Promise<User> {
    return this.findFirstMatching(identifierMatches(identifier));
  }

  findByLogin(login: string): Promise<User> {
    return this.findByIdentifier(toAccountIdentifier(login));
  }

  findAuthenticatableByLogin(login: string): Promise<User> {
    return this.findFirstMatching(
      identifierMatches(toAccountIdentifier(login)).map((match) => ({
        ...match,
        status: In(AUTHENTICATABLE_STATUSES),
      })),
    );
  }

  async isIdentifierTaken(identifier: AccountIdentifier): Promise<boolean> {
    const found = await this.findFirstMatching(
      registeredOnly(identifierMatches(identifier)),
    );

    return Boolean(found);
  }

  async list(query: UserListQuery): Promise<Page<User>> {
    return toPage(
      await this.users.findAndCount({
        where: userListWhere(query),
        order: userListOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async requireById(id: string): Promise<User> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async assertHeldByNobodyElse(
    userId: string,
    identifier: AccountIdentifier,
  ): Promise<void> {
    const holder = await this.findFirstMatching(
      registeredOnly(identifierMatches(identifier)),
    );

    if (holder && holder.id !== userId) {
      throw new ConflictException(IDENTIFIER_TAKEN);
    }
  }

  private findFirstMatching(matches: FindOptionsWhere<User>[]): Promise<User> {
    if (!matches.length) return Promise.resolve(null);

    return this.users.findOne({ where: matches });
  }
}
