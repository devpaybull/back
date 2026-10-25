import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { AccountIdentifier } from '../../common/types/account-identifier';
import { Page, toPage } from '../../common/types/page';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { loginOf } from '../../common/utils/login-of';
import { toAccountIdentifier } from '../../common/utils/to-account-identifier';
import { User } from '../entities/user.entity';
import { AUTHENTICATABLE_STATUSES } from '../types/authenticatable-statuses';
import { UserListQuery } from '../types/user-list-query';
import { identifierMatches } from '../utils/identifier-matches';
import { registeredOnly } from '../utils/registered-only';
import { userListOrder } from '../utils/user-list-order';
import { userListWhere } from '../utils/user-list-where';

export const IDENTIFIER_TAKEN = 'User with this identifier already exists';

export const TELEGRAM_ID_TAKEN = 'User with this Telegram ID already exists';

export const MAX_SEARCH_MATCHED_ACCOUNTS = 1000;

@Injectable()
export class UserDirectoryService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User> {
    return this.users.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];

    return this.users.find({ where: { id: In(ids) } });
  }

  async rankByLogin(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();

    const users = await this.users.find({
      select: { id: true, email: true, telegramUsername: true },
      where: { id: In(ids) },
    });
    const byLogin = users
      .map((user) => ({ id: user.id, login: loginOf(user) }))
      .sort((a, b) => (a.login < b.login ? -1 : a.login > b.login ? 1 : 0));
    const ranks = new Map<string, number>();
    let rank = -1;
    let previousLogin: string | undefined;

    for (const { id, login } of byLogin) {
      if (login !== previousLogin) rank++;
      previousLogin = login;
      ranks.set(id, rank);
    }

    return ranks;
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
    if (!identifier.email && !identifier.telegramUsername) return false;

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

  async findIdsMatching(search: string): Promise<string[]> {
    const pattern = ILike(`%${escapeLikePattern(search)}%`);
    const matches = await this.users.find({
      select: { id: true },
      take: MAX_SEARCH_MATCHED_ACCOUNTS + 1,
      where: [{ email: pattern }, { telegramUsername: pattern }],
    });

    if (matches.length > MAX_SEARCH_MATCHED_ACCOUNTS) {
      throw new BadRequestException(
        `Search matches more than ${MAX_SEARCH_MATCHED_ACCOUNTS} accounts; narrow it`,
      );
    }

    return matches.map((user) => user.id);
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

  async assertTelegramIdHeldByNobodyElse(
    userId: string,
    telegramId: string,
  ): Promise<void> {
    const holder = await this.users.findOne({ where: { telegramId } });

    if (holder && holder.id !== userId) {
      throw new ConflictException(TELEGRAM_ID_TAKEN);
    }
  }

  private findFirstMatching(matches: FindOptionsWhere<User>[]): Promise<User> {
    if (!matches.length) return Promise.resolve(null);

    return this.users.findOne({ where: matches });
  }
}
