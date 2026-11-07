import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Page, toPage } from '../../common/types/page';
import { calendarDateIn } from '../../common/utils/calendar-date-in';
import { INT4_MAX } from '../../common/utils/int4-max';
import { sortDirection } from '../../common/utils/sort-direction';
import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartyDailyVolume } from '../entities/counterparty-daily-volume.entity';
import { CounterpartyRequisiteEvent } from '../entities/counterparty-requisite-event.entity';
import { Counterparty } from '../entities/counterparty.entity';
import { BindableRequisite } from '../types/bindable-requisite';
import { CounterpartyBindingType } from '../types/counterparty-binding-type.enum';
import { CounterpartyChanges } from '../types/counterparty-changes';
import { CounterpartyData } from '../types/counterparty-data';
import { CounterpartyFilter } from '../types/counterparty-filter';
import { CounterpartyListQuery } from '../types/counterparty-list-query';
import { CounterpartyStatusCounts } from '../types/counterparty-status-counts';
import { CounterpartyWindowVolumes } from '../types/counterparty-window-volumes';
import { RequisiteEventKind } from '../types/requisite-event-kind.enum';
import { RequisiteEventListQuery } from '../types/requisite-event-list-query';
import { RequisiteEventReason } from '../types/requisite-event-reason.enum';
import { RequisiteEventSource } from '../types/requisite-event-source.enum';
import { applyCounterpartyFilter } from '../utils/apply-counterparty-filter';
import { bindingTypeAllows } from '../utils/binding-type-allows';
import { counterpartySortExpression } from '../utils/counterparty-sort-expression';
import { windowStartDays } from '../utils/window-start-days';

const NOT_FOUND = 'Counterparty not found';

@Injectable()
export class CounterpartiesService {
  constructor(
    @InjectRepository(Counterparty)
    private readonly counterparties: Repository<Counterparty>,
    @InjectRepository(CounterpartyDailyVolume)
    private readonly dailyVolumes: Repository<CounterpartyDailyVolume>,
    @InjectRepository(CounterpartyRequisiteEvent)
    private readonly requisiteEvents: Repository<CounterpartyRequisiteEvent>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  findById(id: number): Promise<Counterparty | null> {
    return this.counterparties.findOne({ where: { id } });
  }

  async findByIds(ids: number[]): Promise<Counterparty[]> {
    if (ids.length === 0) return [];

    return this.counterparties.find({ where: { id: In(ids) } });
  }

  async findIdsByReference(reference: string): Promise<number[]> {
    const id = /^[1-9]\d*$/.test(reference) ? Number(reference) : null;
    const rows = await this.counterparties.find({
      select: { id: true },
      where: [
        { externalId: reference },
        ...(id !== null && id <= INT4_MAX ? [{ id }] : []),
      ],
    });

    return rows.map((row) => row.id);
  }

  async list(
    query: CounterpartyListQuery,
    now: Date,
  ): Promise<Page<Counterparty>> {
    if (query.bankDetailsIds?.length === 0) return toPage([[], 0], query);

    const direction = sortDirection(query.sortOrder);
    const builder = applyCounterpartyFilter(
      this.counterparties.createQueryBuilder('counterparty'),
      query,
      this.today(now),
    )
      .orderBy(
        counterpartySortExpression(query.sortBy),
        direction,
        'NULLS LAST',
      )
      .addOrderBy('counterparty.id', direction)
      .offset((query.page - 1) * query.limit)
      .limit(query.limit);

    return toPage(await builder.getManyAndCount(), query);
  }

  async countByStatus(
    filter: CounterpartyFilter,
    now: Date,
  ): Promise<CounterpartyStatusCounts> {
    if (filter.bankDetailsIds?.length === 0) {
      return { all: 0, enabled: 0, disabled: 0 };
    }

    const rows = await applyCounterpartyFilter(
      this.counterparties.createQueryBuilder('counterparty'),
      { ...filter, status: undefined },
      this.today(now),
    )
      .select('counterparty.enabled', 'enabled')
      .addSelect('COUNT(*)', 'count')
      .groupBy('counterparty.enabled')
      .getRawMany<{ enabled: boolean; count: string }>();

    const enabled = Number(rows.find((row) => row.enabled)?.count ?? 0);
    const disabled = Number(rows.find((row) => !row.enabled)?.count ?? 0);

    return { all: enabled + disabled, enabled, disabled };
  }

  async windowVolumesOf(
    ids: number[],
    now: Date,
  ): Promise<Map<number, CounterpartyWindowVolumes>> {
    const volumes = new Map<number, CounterpartyWindowVolumes>(
      ids.map((id) => [id, { volume7d: toFiat(0), volume30d: toFiat(0) }]),
    );
    if (ids.length === 0) return volumes;

    const { since7, since30 } = windowStartDays(this.today(now));
    const rows = await this.dailyVolumes
      .createQueryBuilder('volume')
      .select('volume.counterpartyId', 'counterpartyId')
      .addSelect(
        'COALESCE(SUM(volume.paidAmount) FILTER (WHERE volume.day >= :since7), 0)',
        'volume7d',
      )
      .addSelect('COALESCE(SUM(volume.paidAmount), 0)', 'volume30d')
      .where('volume.counterpartyId IN (:...ids)', { ids })
      .andWhere('volume.day >= :since30', { since30 })
      .setParameter('since7', since7)
      .groupBy('volume.counterpartyId')
      .getRawMany<{
        counterpartyId: number;
        volume7d: string;
        volume30d: string;
      }>();

    for (const row of rows) {
      volumes.set(Number(row.counterpartyId), {
        volume7d: toFiat(row.volume7d),
        volume30d: toFiat(row.volume30d),
      });
    }

    return volumes;
  }

  async update(
    id: number,
    changes: CounterpartyChanges,
    actorUserId: string,
  ): Promise<Counterparty> {
    if (
      changes.enabled === undefined &&
      changes.blacklisted === undefined &&
      changes.autoEnableForbidden === undefined
    ) {
      throw new BadRequestException('No changes were given');
    }

    return this.counterparties.manager.transaction(async (manager) => {
      const counterparty = await this.lockWithin(manager, id);
      const actions: string[] = [];
      const wasBlacklisted = counterparty.blacklistedAt !== null;
      const blacklisted = changes.blacklisted ?? wasBlacklisted;

      if (changes.enabled === true && blacklisted) {
        throw new ConflictException(
          'A blacklisted counterparty cannot be enabled',
        );
      }

      if (blacklisted !== wasBlacklisted) {
        counterparty.blacklistedAt = blacklisted ? new Date() : null;
        counterparty.blacklistedByUserId = blacklisted ? actorUserId : null;
        actions.push(
          blacklisted
            ? 'counterparty.blacklisted'
            : 'counterparty.unblacklisted',
        );
      }

      const enabled = blacklisted
        ? false
        : (changes.enabled ?? counterparty.enabled);
      if (enabled !== counterparty.enabled) {
        counterparty.enabled = enabled;
        actions.push(
          enabled ? 'counterparty.enabled' : 'counterparty.disabled',
        );
      }

      if (
        changes.autoEnableForbidden !== undefined &&
        changes.autoEnableForbidden !== counterparty.autoEnableForbidden
      ) {
        counterparty.autoEnableForbidden = changes.autoEnableForbidden;
        actions.push(
          changes.autoEnableForbidden
            ? 'counterparty.auto_enable_forbidden'
            : 'counterparty.auto_enable_allowed',
        );
      }

      if (actions.length === 0) return counterparty;

      await manager.save(counterparty);
      for (const action of actions) {
        await this.audit.record(
          {
            actorUserId,
            action,
            reason: changes.reason ?? null,
            metadata: {
              counterpartyId: counterparty.id,
              merchantId: counterparty.merchantId,
            },
          },
          manager,
        );
      }

      return counterparty;
    });
  }

  async bindWithin(
    manager: EntityManager,
    counterpartyId: number,
    requisite: BindableRequisite,
    bindingType: CounterpartyBindingType,
    actorUserId: string | null,
  ): Promise<Counterparty> {
    const counterparty = await this.lockWithin(manager, counterpartyId);

    if (counterparty.bankDetailsId !== null) {
      throw new ConflictException(
        'The counterparty already has a requisite; replace it instead',
      );
    }
    this.assertBindable(requisite, bindingType);
    await this.assertSlotFree(manager, requisite);

    counterparty.bankDetailsId = requisite.id;
    counterparty.bindingType = bindingType;
    counterparty.boundAt = new Date();
    counterparty.boundByUserId = actorUserId;
    await manager.save(counterparty);

    await this.writeRequisiteEvent(manager, {
      counterpartyId,
      bankDetailsId: requisite.id,
      kind: RequisiteEventKind.Bound,
      source: actorUserId
        ? RequisiteEventSource.Manual
        : RequisiteEventSource.System,
      reason: actorUserId ? null : RequisiteEventReason.DealIssued,
      actorUserId,
    });
    await this.audit.record(
      {
        actorUserId,
        action: 'counterparty.requisite_bound',
        metadata: {
          counterpartyId,
          merchantId: counterparty.merchantId,
          bankDetailsId: requisite.id,
          traderUserId: requisite.userId,
          bindingType,
        },
      },
      manager,
    );

    return counterparty;
  }

  async replaceWithin(
    manager: EntityManager,
    counterpartyId: number,
    requisite: BindableRequisite,
    actorUserId: string,
  ): Promise<Counterparty> {
    const counterparty = await this.lockWithin(manager, counterpartyId);
    const previousId = counterparty.bankDetailsId;

    if (previousId === null) {
      throw new ConflictException(
        'The counterparty has no requisite to replace',
      );
    }
    if (previousId === requisite.id) {
      throw new ConflictException('This requisite is already bound');
    }
    this.assertBindable(requisite, counterparty.bindingType);
    await this.assertSlotFree(manager, requisite);

    counterparty.bankDetailsId = requisite.id;
    counterparty.boundAt = new Date();
    counterparty.boundByUserId = actorUserId;
    await manager.save(counterparty);

    for (const [bankDetailsId, kind] of [
      [previousId, RequisiteEventKind.Unbound],
      [requisite.id, RequisiteEventKind.Bound],
    ] as const) {
      await this.writeRequisiteEvent(manager, {
        counterpartyId,
        bankDetailsId,
        kind,
        source: RequisiteEventSource.Manual,
        reason: RequisiteEventReason.Replaced,
        actorUserId,
      });
    }
    await this.audit.record(
      {
        actorUserId,
        action: 'counterparty.requisite_replaced',
        metadata: {
          counterpartyId,
          merchantId: counterparty.merchantId,
          previousBankDetailsId: previousId,
          bankDetailsId: requisite.id,
          traderUserId: requisite.userId,
        },
      },
      manager,
    );

    return counterparty;
  }

  async unbind(
    counterpartyId: number,
    actorUserId: string,
  ): Promise<Counterparty> {
    return this.counterparties.manager.transaction(async (manager) => {
      const counterparty = await this.lockWithin(manager, counterpartyId);
      const previousId = counterparty.bankDetailsId;

      if (previousId === null) {
        throw new NotFoundException('The counterparty has no requisite');
      }

      this.clearBinding(counterparty);
      await manager.save(counterparty);
      await this.writeRequisiteEvent(manager, {
        counterpartyId,
        bankDetailsId: previousId,
        kind: RequisiteEventKind.Unbound,
        source: RequisiteEventSource.Manual,
        reason: null,
        actorUserId,
      });
      await this.audit.record(
        {
          actorUserId,
          action: 'counterparty.requisite_unbound',
          metadata: {
            counterpartyId,
            merchantId: counterparty.merchantId,
            bankDetailsId: previousId,
          },
        },
        manager,
      );

      return counterparty;
    });
  }

  async unbindRequisiteWithin(
    manager: EntityManager,
    bankDetailsId: string,
    reason: RequisiteEventReason,
  ): Promise<void> {
    const bound = await manager.find(Counterparty, {
      where: { bankDetailsId },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });

    for (const counterparty of bound) {
      this.clearBinding(counterparty);
      await manager.save(counterparty);
      await this.writeRequisiteEvent(manager, {
        counterpartyId: counterparty.id,
        bankDetailsId,
        kind: RequisiteEventKind.Unbound,
        source: RequisiteEventSource.System,
        reason,
        actorUserId: null,
      });
    }
  }

  async countBoundByRequisites(
    bankDetailsIds: readonly string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>(bankDetailsIds.map((id) => [id, 0]));

    if (bankDetailsIds.length === 0) return counts;

    const rows = await this.counterparties
      .createQueryBuilder('counterparty')
      .select('counterparty.bankDetailsId', 'bankDetailsId')
      .addSelect('COUNT(*)', 'bound')
      .where('counterparty.bankDetailsId IN (:...ids)', {
        ids: [...bankDetailsIds],
      })
      .groupBy('counterparty.bankDetailsId')
      .getRawMany<{ bankDetailsId: string; bound: string }>();

    rows.forEach((row) => counts.set(row.bankDetailsId, Number(row.bound)));

    return counts;
  }

  async listRequisiteEvents(
    counterpartyId: number,
    query: RequisiteEventListQuery,
  ): Promise<Page<CounterpartyRequisiteEvent>> {
    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.requisiteEvents.findAndCount({
        where: { counterpartyId },
        order: { createdAt: direction, id: direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async findOrCreate(
    merchantId: string,
    externalId: string,
    data: CounterpartyData = {},
  ): Promise<Counterparty> {
    const existing = await this.counterparties.findOne({
      where: { merchantId, externalId },
    });
    if (existing) return existing;

    await this.counterparties
      .createQueryBuilder()
      .insert()
      .values({
        merchantId,
        externalId,
        name: data.name ?? null,
        contact: data.contact ?? null,
        payload: data.payload ?? null,
      })
      .orIgnore()
      .execute();

    return this.counterparties.findOneOrFail({
      where: { merchantId, externalId },
    });
  }

  private today(now: Date): string {
    return calendarDateIn(now, this.config.get<string>('BUSINESS_TIMEZONE'));
  }

  private async lockWithin(
    manager: EntityManager,
    id: number,
  ): Promise<Counterparty> {
    const counterparty = await manager.findOne(Counterparty, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!counterparty) throw new NotFoundException(NOT_FOUND);

    return counterparty;
  }

  private assertBindable(
    requisite: BindableRequisite,
    bindingType: CounterpartyBindingType,
  ): void {
    if (!requisite.counterpartyOnly) {
      throw new ConflictException(
        'Only a counterparty-only requisite can be bound to a counterparty',
      );
    }
    if (!bindingTypeAllows(bindingType, requisite)) {
      throw new BadRequestException(
        `The requisite carries nothing the binding type ${bindingType} serves`,
      );
    }
  }

  private async assertSlotFree(
    manager: EntityManager,
    requisite: BindableRequisite,
  ): Promise<void> {
    if (requisite.maxCounterparties === null) return;

    const bound = await manager.count(Counterparty, {
      where: { bankDetailsId: requisite.id },
    });

    if (bound >= requisite.maxCounterparties) {
      throw new ConflictException(
        `The requisite already holds its ${requisite.maxCounterparties} counterparties`,
      );
    }
  }

  private clearBinding(counterparty: Counterparty): void {
    counterparty.bankDetailsId = null;
    counterparty.bindingType = null;
    counterparty.boundAt = null;
    counterparty.boundByUserId = null;
  }

  private async writeRequisiteEvent(
    manager: EntityManager,
    event: Pick<
      CounterpartyRequisiteEvent,
      | 'counterpartyId'
      | 'bankDetailsId'
      | 'kind'
      | 'source'
      | 'reason'
      | 'actorUserId'
    >,
  ): Promise<void> {
    await manager.save(manager.create(CounterpartyRequisiteEvent, event));
  }
}
