import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { AccountIdentifier } from '../../common/types/account-identifier';
import { Page, toPage } from '../../common/types/page';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { formatCrypto } from '../../common/utils/format-crypto';
import { loginOf } from '../../common/utils/login-of';
import { sortDirection } from '../../common/utils/sort-direction';
import { toAccountIdentifier } from '../../common/utils/to-account-identifier';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { RateScope } from '../../transactions/types/rate-scope.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { User } from '../entities/user.entity';
import { AUTHENTICATABLE_STATUSES } from '../types/authenticatable-statuses';
import { TradingSortField } from '../types/trading-sort-field';
import { UserListFilter } from '../types/user-list-filter';
import { UserListQuery } from '../types/user-list-query';
import { UserSortField } from '../types/user-sort-field.enum';
import { UserStatus } from '../types/user-status.enum';
import { identifierMatches } from '../utils/identifier-matches';
import { registeredOnly } from '../utils/registered-only';
import { userListOrder } from '../utils/user-list-order';
import { userListWhere } from '../utils/user-list-where';

export const IDENTIFIER_TAKEN = 'User with this identifier already exists';

export const TELEGRAM_ID_TAKEN = 'User with this Telegram ID already exists';

export const MAX_SEARCH_MATCHED_ACCOUNTS = 1000;

export const TRADING_ROLES: readonly Role[] = [Role.Trader, Role.LeadTrader];

const TRADING_SORT_FIELDS: readonly UserSortField[] = [
  UserSortField.Balance,
  UserSortField.InsuranceMin,
  UserSortField.Rate,
];

const isTradingSort = (field: UserSortField): field is TradingSortField =>
  TRADING_SORT_FIELDS.includes(field);

const generalRow = (alias: string): string =>
  `${alias}."bankId" IS NULL AND ${alias}."fromAmount" IS NULL AND ${alias}."toAmount" IS NULL`;

const TRADER_MAX_PAY_IN = `(
  SELECT MAX(rate."payInPercent") FROM method_rates rate
  WHERE rate.scope = :traderScope
    AND rate.method IN (:...rateMethods)
    AND (
      (COALESCE(settings."individualRatesEnabled", false) AND rate."subjectUserId" = "user"."id")
      OR (
        rate."subjectUserId" IS NULL AND rate."subjectMerchantId" IS NULL AND ${generalRow('rate')}
        AND NOT (
          COALESCE(settings."individualRatesEnabled", false) AND EXISTS (
            SELECT 1 FROM method_rates own
            WHERE own.scope = :traderScope AND own."subjectUserId" = "user"."id"
              AND own.method = rate.method AND ${generalRow('own')}
          )
        )
      )
    )
)`;

const LEAD_MAX_PAY_IN = `(
  SELECT MAX(share."payInPercent") FROM (
    SELECT link."payInPercent" FROM trader_leads link
    WHERE link."leadUserId" = "user"."id"
    UNION ALL
    SELECT detail."payInPercent" FROM lead_rates detail
    JOIN trader_leads link ON link.id = detail."traderLeadId"
    WHERE link."leadUserId" = "user"."id"
  ) share
)`;

const SORT_VALUE: Record<TradingSortField, string> = {
  [UserSortField.Balance]: 'wallet."mainBalance"',
  [UserSortField.InsuranceMin]:
    'COALESCE(settings."insurancePayInMin", CAST(:insurancePayInMinDefault AS numeric))',
  [UserSortField.Rate]: `CASE "user"."role" WHEN :traderRole THEN ${TRADER_MAX_PAY_IN} WHEN :leadTraderRole THEN ${LEAD_MAX_PAY_IN} END`,
};

@Injectable()
export class UserDirectoryService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User> {
    return this.users.findOne({ where: { id } });
  }

  async statusWithin(
    manager: EntityManager,
    id: string,
  ): Promise<UserStatus | null> {
    const user = await manager.getRepository(User).findOne({
      select: { id: true, status: true },
      where: { id },
    });

    return user?.status ?? null;
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
    const { sortBy } = query;

    if (isTradingSort(sortBy)) return this.listByTradingValue(query, sortBy);

    return toPage(
      await this.users.findAndCount({
        where: userListWhere(query),
        order: userListOrder(sortBy, query.sortOrder),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async countByRole(
    filter: Omit<UserListFilter, 'role'>,
  ): Promise<Record<Role, number>> {
    const rows = await this.filtered(
      this.users
        .createQueryBuilder('user')
        .select('"user"."role"', 'role')
        .addSelect('COUNT(*)', 'count')
        .groupBy('"user"."role"'),
      filter,
    ).getRawMany<{ role: Role; count: string }>();
    const counts = Object.fromEntries(
      Object.values(Role).map((role) => [role, 0]),
    ) as Record<Role, number>;

    for (const row of rows) counts[row.role] = Number(row.count);

    return counts;
  }

  private async listByTradingValue(
    query: UserListQuery,
    sortBy: TradingSortField,
  ): Promise<Page<User>> {
    if (
      !query.role?.length ||
      query.role.some((role) => !TRADING_ROLES.includes(role))
    ) {
      throw new BadRequestException(
        `sortBy=${sortBy} needs a role filter of trader and/or lead_trader only`,
      );
    }

    const direction = sortDirection(query.sortOrder);
    const builder = this.filtered(
      this.users
        .createQueryBuilder('user')
        .leftJoin(Wallet, 'wallet', 'wallet."userId" = "user"."id"')
        .leftJoin(TraderSettings, 'settings', 'settings."userId" = "user"."id"')
        .addSelect(SORT_VALUE[sortBy], 'sort_value')
        .setParameters({
          traderScope: RateScope.Trader,
          rateMethods: TRANSACTION_METHOD_CODES,
          traderRole: Role.Trader,
          leadTraderRole: Role.LeadTrader,
          insurancePayInMinDefault: query.insurancePayInMinDefault
            ? formatCrypto(query.insurancePayInMinDefault)
            : null,
        })
        .orderBy('sort_value', direction, 'NULLS LAST')
        .addOrderBy('"user"."id"', direction)
        .offset((query.page - 1) * query.limit)
        .limit(query.limit),
      query,
    );

    return toPage(await builder.getManyAndCount(), query);
  }

  private filtered(
    builder: SelectQueryBuilder<User>,
    filter: UserListFilter,
  ): SelectQueryBuilder<User> {
    const where = userListWhere(filter);

    return Array.isArray(where) || Object.keys(where).length
      ? builder.where(where)
      : builder;
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
