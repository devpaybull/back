import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Page, toPage } from '../../common/types/page';
import { sortDirection } from '../../common/utils/sort-direction';
import { WalletService } from '../../transactions/services/wallet.service';
import { roundMoney } from '../../transactions/utils/round-money';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { DebtEvent } from '../entities/debt-event.entity';
import { Debt } from '../entities/debt.entity';
import { DEBT_BORROWER_ROLES } from '../types/debt-borrower-roles';
import { DebtChanges } from '../types/debt-changes';
import { DebtEventListQuery } from '../types/debt-event-list-query';
import { DebtEventSortField } from '../types/debt-event-sort-field.enum';
import { DebtEventType } from '../types/debt-event-type.enum';
import { DebtListQuery } from '../types/debt-list-query';
import { DebtSortField } from '../types/debt-sort-field.enum';
import { DebtStatus } from '../types/debt-status.enum';

const DEBT_NOT_FOUND = 'Debt not found';
const DEBT_ROW_RELATIONS = { user: true, issuedBy: true };
const MAX_INT = 2147483647;

const WRITE_OFF_ACTIONS: Record<
  DebtEventType.ManualWriteOff | DebtEventType.AutoWriteOff,
  string
> = {
  [DebtEventType.ManualWriteOff]: 'debt.written_off',
  [DebtEventType.AutoWriteOff]: 'debt.auto_written_off',
};

@Injectable()
export class DebtsService {
  constructor(
    @InjectRepository(Debt)
    private readonly debts: Repository<Debt>,
    @InjectRepository(DebtEvent)
    private readonly events: Repository<DebtEvent>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly wallets: WalletService,
    private readonly directory: UserDirectoryService,
    private readonly audit: AuditService,
  ) {}

  async issue(
    userId: string,
    amount: number,
    actorUserId: string,
  ): Promise<Debt> {
    const debtor = await this.directory.findById(userId);

    if (!debtor) throw new NotFoundException('User not found');

    if (!DEBT_BORROWER_ROLES.includes(debtor.role)) {
      throw new BadRequestException(
        'A debt can only be issued to a trader or a lead trader',
      );
    }

    const id = await this.dataSource.transaction(async (manager) => {
      const operation = await this.wallets.creditDebtWithin(
        manager,
        userId,
        amount,
      );
      const debt = await manager.save(
        manager.create(Debt, {
          userId,
          issuedByUserId: actorUserId,
          amount,
          remaining: amount,
          comment: null,
          autoWriteOffAt: null,
          autoWriteOffPaused: false,
        }),
      );
      await manager.save(
        manager.create(DebtEvent, {
          debtId: debt.id,
          type: DebtEventType.Issued,
          amount,
          actorUserId,
          balanceOperationId: operation.id,
        }),
      );
      await this.audit.record(
        {
          actorUserId,
          targetUserId: userId,
          action: 'debt.issued',
          metadata: {
            debtId: debt.id,
            amount,
            balanceOperationId: operation.id,
          },
        },
        manager,
      );

      return debt.id;
    });

    return this.requireById(id);
  }

  async writeOff(
    debtId: number,
    amount: number | undefined,
    actorUserId: string,
  ): Promise<Debt> {
    await this.dataSource.transaction(async (manager) => {
      const debt = await manager.findOne(Debt, {
        where: { id: debtId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!debt) throw new NotFoundException(DEBT_NOT_FOUND);

      if (debt.remaining <= 0) {
        throw new ConflictException('Debt is already repaid');
      }

      const withheld = amount ?? debt.remaining;

      if (withheld > debt.remaining) {
        throw new BadRequestException(
          'Write-off amount exceeds the remaining debt',
        );
      }

      await this.withhold(
        manager,
        debt,
        withheld,
        DebtEventType.ManualWriteOff,
        actorUserId,
      );
    });

    return this.requireById(debtId);
  }

  async findDueIds(now: Date, limit: number): Promise<number[]> {
    const due = await this.debts.find({
      select: { id: true },
      where: {
        autoWriteOffAt: LessThanOrEqual(now),
        autoWriteOffPaused: false,
        remaining: MoreThan(0),
      },
      order: { autoWriteOffAt: 'ASC', id: 'ASC' },
      take: limit,
    });

    return due.map((debt) => debt.id);
  }

  autoWriteOff(debtId: number, now: Date): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const debt = await manager
        .getRepository(Debt)
        .createQueryBuilder('debt')
        .where('debt.id = :debtId', { debtId })
        .andWhere('debt.autoWriteOffAt <= :now', { now })
        .andWhere('debt.autoWriteOffPaused = false')
        .andWhere('debt.remaining > 0')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();

      if (!debt) return false;

      debt.autoWriteOffAt = null;
      await this.withhold(
        manager,
        debt,
        debt.remaining,
        DebtEventType.AutoWriteOff,
        null,
      );

      return true;
    });
  }

  async update(
    debtId: number,
    changes: DebtChanges,
    actorUserId: string,
  ): Promise<Debt> {
    const patch: DebtChanges = {
      ...(changes.comment !== undefined ? { comment: changes.comment } : {}),
      ...(changes.autoWriteOffAt !== undefined
        ? { autoWriteOffAt: changes.autoWriteOffAt }
        : {}),
      ...(changes.autoWriteOffPaused !== undefined
        ? { autoWriteOffPaused: changes.autoWriteOffPaused }
        : {}),
    };

    await this.dataSource.transaction(async (manager) => {
      const debt = await manager.findOne(Debt, {
        where: { id: debtId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!debt) throw new NotFoundException(DEBT_NOT_FOUND);

      const momentAfter =
        patch.autoWriteOffAt !== undefined
          ? patch.autoWriteOffAt
          : debt.autoWriteOffAt;
      const unpausesPastMoment =
        debt.autoWriteOffPaused &&
        patch.autoWriteOffPaused === false &&
        momentAfter !== null &&
        momentAfter <= new Date();

      if (unpausesPastMoment) {
        throw new ConflictException(
          'The auto write-off moment has passed; give a new one to unpause',
        );
      }

      await manager.update(Debt, { id: debtId }, patch);
      await this.audit.record(
        {
          actorUserId,
          targetUserId: debt.userId,
          action: 'debt.updated',
          metadata: { debtId, ...patch },
        },
        manager,
      );
    });

    return this.requireById(debtId);
  }

  async list(query: DebtListQuery): Promise<Page<Debt>> {
    const where = await this.listWhere(query);

    if (where.length === 0) return toPage([[], 0], query);

    if (query.sortBy === DebtSortField.User) {
      return toPage(await this.pageByDebtorLogin(query, where), query);
    }

    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.debts.findAndCount({
        where,
        relations: DEBT_ROW_RELATIONS,
        order: { [query.sortBy]: direction, id: direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async listEvents(
    debtId: number,
    query: DebtEventListQuery,
  ): Promise<Page<DebtEvent>> {
    if (!(await this.debts.findOne({ where: { id: debtId } }))) {
      throw new NotFoundException(DEBT_NOT_FOUND);
    }

    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.events.findAndCount({
        where: { debtId },
        relations: { actor: true },
        order:
          query.sortBy === DebtEventSortField.Id
            ? { id: direction }
            : { createdAt: direction, id: direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async debtIdsByBalanceOperation(
    balanceOperationIds: number[],
  ): Promise<Map<number, number>> {
    if (balanceOperationIds.length === 0) return new Map();

    const found = await this.events.find({
      where: { balanceOperationId: In(balanceOperationIds) },
      select: { debtId: true, balanceOperationId: true },
    });

    return new Map(
      found.map((event) => [event.balanceOperationId, event.debtId]),
    );
  }

  async requireById(id: number): Promise<Debt> {
    const debt = await this.debts.findOne({
      where: { id },
      relations: DEBT_ROW_RELATIONS,
    });

    if (!debt) throw new NotFoundException(DEBT_NOT_FOUND);

    return debt;
  }

  private async withhold(
    manager: EntityManager,
    debt: Debt,
    amount: number,
    type: DebtEventType.ManualWriteOff | DebtEventType.AutoWriteOff,
    actorUserId: string | null,
  ): Promise<void> {
    const operation = await this.wallets.debitDebtWithin(
      manager,
      debt.userId,
      amount,
    );
    debt.remaining = roundMoney(debt.remaining - amount);
    await manager.save(debt);
    await manager.save(
      manager.create(DebtEvent, {
        debtId: debt.id,
        type,
        amount,
        actorUserId,
        balanceOperationId: operation.id,
      }),
    );
    await this.audit.record(
      {
        actorUserId,
        targetUserId: debt.userId,
        action: WRITE_OFF_ACTIONS[type],
        metadata: {
          debtId: debt.id,
          amount,
          remaining: debt.remaining,
          balanceOperationId: operation.id,
        },
      },
      manager,
    );
  }

  private async pageByDebtorLogin(
    query: DebtListQuery,
    where: FindOptionsWhere<Debt>[],
  ): Promise<[Debt[], number]> {
    const matching = await this.debts.find({
      where,
      select: { id: true, userId: true },
    });
    const ranks = await this.directory.rankByLogin([
      ...new Set(matching.map((debt) => debt.userId)),
    ]);
    const rankOf = (debt: Debt) =>
      ranks.get(debt.userId) ?? Number.MAX_SAFE_INTEGER;
    const sign = sortDirection(query.sortOrder) === 'ASC' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;
    const pageIds = matching
      .sort((a, b) => sign * (rankOf(a) - rankOf(b) || a.id - b.id))
      .slice(skip, skip + query.limit)
      .map((debt) => debt.id);

    if (pageIds.length === 0) return [[], matching.length];

    const rows = new Map(
      (
        await this.debts.find({
          where: { id: In(pageIds) },
          relations: DEBT_ROW_RELATIONS,
        })
      ).map((debt) => [debt.id, debt]),
    );

    return [
      pageIds.flatMap((id) => (rows.has(id) ? [rows.get(id)] : [])),
      matching.length,
    ];
  }

  private async listWhere(
    query: DebtListQuery,
  ): Promise<FindOptionsWhere<Debt>[]> {
    const filters: FindOptionsWhere<Debt> = {
      ...(query.status === DebtStatus.Active ? { remaining: MoreThan(0) } : {}),
      ...(query.status === DebtStatus.Repaid ? { remaining: 0 } : {}),
      ...(query.userId !== undefined ? { userId: query.userId } : {}),
    };

    if (!query.search) return [filters];

    const branches: FindOptionsWhere<Debt>[] = [];
    const matchingUserIds = (
      await this.directory.findIdsMatching(query.search)
    ).filter((id) => query.userId === undefined || id === query.userId);

    if (matchingUserIds.length > 0) {
      branches.push({ ...filters, userId: In(matchingUserIds) });
    }

    if (/^\d+$/.test(query.search) && Number(query.search) <= MAX_INT) {
      branches.push({ ...filters, id: Number(query.search) });
    }

    return branches;
  }
}
