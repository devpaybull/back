import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  ILike,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { ActivityReadsService } from '../audit/services/activity-reads.service';
import { AuditService } from '../audit/services/audit.service';
import { ActivityAction } from '../audit/types/activity-action.enum';
import { ActivityReadScope } from '../audit/types/activity-read-scope.enum';
import { AuditSortField } from '../audit/types/audit-sort-field.enum';
import { BanksService } from '../banks/banks.service';
import { Fiat } from '../common/types/fiat';
import { Page, PageRequest, toPage } from '../common/types/page';
import { SortOrder } from '../common/enums/sort-order.enum';
import { escapeLikePattern } from '../common/utils/escape-like-pattern';
import { sortDirection } from '../common/utils/sort-direction';
import { toFiat } from '../common/utils/to-fiat';
import { Counterparty } from '../counterparties/entities/counterparty.entity';
import { CounterpartiesService } from '../counterparties/services/counterparties.service';
import { CounterpartyBindingType } from '../counterparties/types/counterparty-binding-type.enum';
import { RequisiteEventReason } from '../counterparties/types/requisite-event-reason.enum';
import { DevicesService } from '../devices/devices.service';
import { MobileOperatorsService } from '../mobile-operators/mobile-operators.service';
import { BankDetailTagLink } from './entities/bank-detail-tag-link.entity';
import { BankDetailTag } from './entities/bank-detail-tag.entity';
import { BankDetails } from './entities/bank-details.entity';
import {
  BankDetailsAction,
  REQUISITE_HISTORY_ACTIONS,
} from './types/bank-details-action.enum';
import { BankDetailsStatus } from './types/bank-details-status.enum';
import { BankDetailsStatusCounts } from './types/bank-details-status-counts';
import { BankDetailsTagSummary } from './types/bank-details-tag-summary';
import { RequisiteCandidate } from './types/requisite-candidate';
import { RequisiteCandidateQuery } from './types/requisite-candidate-query';
import { RequisiteHistoryEntry } from './types/requisite-history-entry';
import { RequisiteHistoryReadState } from './types/requisite-history-read-state';
import { TagListQuery } from './types/tag-list-query';
import { BankDetailsListQuery } from './types/bank-details-list-query';
import { BankDetailsPayload } from './types/bank-details-payload';
import { BankDetailsSupervision } from './types/bank-details-supervision';
import { BankDetailsType } from './types/bank-details-type.enum';
import { CounterpartyRequisiteQuery } from './types/counterparty-requisite-query';
import { CreateBankDetailsInput } from './types/create-bank-details-input';
import { OwnBankDetailsChanges } from './types/own-bank-details-changes';
import { bankDetailsActivityMetadata } from './utils/bank-details-activity-metadata';
import { bankDetailsListOrder } from './utils/bank-details-list-order';
import { bankDetailsListWhere } from './utils/bank-details-list-where';
import { toggledLimits } from './utils/toggled-limits';

const MAX_SEARCH_MATCHED_REQUISITES = 1000;
const UNIQUE_VIOLATION = '23505';
const TAG_NOT_FOUND = 'Tag not found';
const TAG_TAKEN = 'A tag with this name already exists';
const DEVICE_DELETED =
  'The device of these bank details is deleted; move them to another device first';

const RELATIONS: FindOptionsRelations<BankDetails> = {
  bank: { country: true, currency: true },
  mobileOperator: true,
  device: true,
  user: true,
  bannedBy: true,
};

@Injectable()
export class BankDetailsService {
  constructor(
    @InjectRepository(BankDetails)
    private readonly bankDetails: Repository<BankDetails>,
    private readonly banks: BanksService,
    private readonly devices: DevicesService,
    private readonly mobileOperators: MobileOperatorsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly counterparties: CounterpartiesService,
    @InjectRepository(BankDetailTag)
    private readonly tags: Repository<BankDetailTag>,
    private readonly reads: ActivityReadsService,
  ) {}

  get counterpartyMinAmount(): Fiat {
    return toFiat(this.config.get<string>('COUNTERPARTY_MIN_AMOUNT'));
  }

  async create(
    input: CreateBankDetailsInput,
    impersonatorUserId?: string | null,
  ): Promise<BankDetails> {
    const payload: BankDetailsPayload = {
      type: input.type,
      bankId: input.bankId ?? null,
      mobileOperatorId: input.mobileOperatorId ?? null,
      card: input.card ?? null,
      phone: input.phone ?? null,
    };

    this.assertPayloadFitsType(payload);
    await this.assertReferencesExist(payload);
    this.assertMinAmountNotForced(Boolean(input.counterpartyOnly), input);

    const counterpartyOnly = input.counterpartyOnly ?? false;
    const maxCounterparties = this.settledSlots(
      counterpartyOnly,
      input.maxCounterparties,
      null,
    );
    const limits = toggledLimits({}, input);

    if (limits.dailyAmountLimit === null) {
      throw new BadRequestException('dailyAmountLimit is required');
    }

    await this.assertDeviceIsOwnedBy(input.deviceId, input.userId);
    const tagIds = await this.ownTagIds(input.tagIds ?? [], input.userId);

    return this.bankDetails.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BankDetails);
      const created = await repository.save(
        repository.create({
          userId: input.userId,
          ...payload,
          deviceId: input.deviceId,
          cardholderName: input.cardholderName ?? null,
          ...limits,
          counterpartyOnly,
          maxCounterparties,
          sameBankOnly: input.sameBankOnly ?? false,
          reserve: input.reserve ?? false,
          ...(input.active !== undefined ? { active: input.active } : {}),
        }),
      );
      await this.replaceTagsWithin(manager, created.id, tagIds);
      const details = await repository.findOne({
        where: { id: created.id },
        relations: RELATIONS,
      });

      await this.audit.record(
        {
          actorUserId: input.userId,
          impersonatorUserId: impersonatorUserId ?? null,
          targetUserId: input.userId,
          action: ActivityAction.BankDetailsAdded,
          metadata: bankDetailsActivityMetadata(details),
        },
        manager,
      );

      return details;
    });
  }

  async list(query: BankDetailsListQuery): Promise<Page<BankDetails>> {
    return toPage(
      await this.bankDetails.findAndCount({
        where: bankDetailsListWhere(query),
        order: bankDetailsListOrder(query),
        relations: RELATIONS,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async listIds(query: BankDetailsListQuery): Promise<string[]> {
    const rows = await this.bankDetails.find({
      select: { id: true },
      where: bankDetailsListWhere(query),
      order: { id: sortDirection(query.sortOrder) },
    });

    return rows.map((row) => row.id);
  }

  async listCounterpartyOnly(
    query: CounterpartyRequisiteQuery,
  ): Promise<Page<BankDetails>> {
    const filters = {
      counterpartyOnly: true,
      ...(query.type ? { type: query.type } : {}),
    };
    const searched = query.search
      ? ILike(`%${escapeLikePattern(query.search)}%`)
      : undefined;
    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.bankDetails.findAndCount({
        where: searched
          ? [
              { ...filters, card: searched },
              { ...filters, phone: searched },
              { ...filters, cardholderName: searched },
            ]
          : filters,
        order: { createdAt: direction, id: direction },
        relations: RELATIONS,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async findIdsMatching(search: string): Promise<string[]> {
    const searched = ILike(`%${escapeLikePattern(search)}%`);
    const rows = await this.bankDetails.find({
      select: { id: true },
      take: MAX_SEARCH_MATCHED_REQUISITES + 1,
      where: [
        { card: searched },
        { phone: searched },
        { cardholderName: searched },
      ],
    });

    if (rows.length > MAX_SEARCH_MATCHED_REQUISITES) {
      throw new BadRequestException(
        `Search matches more than ${MAX_SEARCH_MATCHED_REQUISITES} requisites; narrow it`,
      );
    }

    return rows.map((row) => row.id);
  }

  async findIdsOfUsers(userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];

    const rows = await this.bankDetails.find({
      select: { id: true },
      where: { userId: In([...userIds]) },
    });

    return rows.map((row) => row.id);
  }

  bindToCounterparty(
    bankDetailsId: string,
    counterpartyId: number,
    bindingType: CounterpartyBindingType,
    actorUserId: string,
  ): Promise<Counterparty> {
    return this.bankDetails.manager.transaction(async (manager) =>
      this.counterparties.bindWithin(
        manager,
        counterpartyId,
        await this.lockWithin(manager, bankDetailsId),
        bindingType,
        actorUserId,
      ),
    );
  }

  replaceCounterpartyRequisite(
    bankDetailsId: string,
    counterpartyId: number,
    actorUserId: string,
  ): Promise<Counterparty> {
    return this.bankDetails.manager.transaction(async (manager) =>
      this.counterparties.replaceWithin(
        manager,
        counterpartyId,
        await this.lockWithin(manager, bankDetailsId),
        actorUserId,
      ),
    );
  }

  async findByIdsInOrder(ids: string[]): Promise<BankDetails[]> {
    if (ids.length === 0) return [];

    const rows = new Map(
      (
        await this.bankDetails.find({
          where: { id: In(ids) },
          relations: RELATIONS,
        })
      ).map((row) => [row.id, row]),
    );

    return ids.flatMap((id) => (rows.has(id) ? [rows.get(id)] : []));
  }

  async findCandidates(
    query: RequisiteCandidateQuery,
    now: Date = new Date(),
  ): Promise<RequisiteCandidate[]> {
    const rows = await this.bankDetails.find({
      where: {
        counterpartyOnly: query.counterpartyOnly,
        ...(query.type ? { type: query.type } : {}),
        ...(query.withCard ? { card: Not(IsNull()) } : {}),
        ...(query.withPhone ? { phone: Not(IsNull()) } : {}),
      },
      relations: { bank: { currency: true } },
      order: { id: 'ASC' },
    });
    const online = new Set(
      await this.devices.onlineDeviceIds(
        [...new Set(rows.map((row) => row.deviceId))],
        now,
      ),
    );

    return rows.map((row) =>
      this.toRequisiteCandidate(row, online.has(row.deviceId)),
    );
  }

  async lockCandidateWithin(
    manager: EntityManager,
    id: string,
    now: Date = new Date(),
  ): Promise<RequisiteCandidate | null> {
    const row = await manager.findOne(BankDetails, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!row) return null;

    const online = await this.devices.onlineDeviceIds([row.deviceId], now);

    return this.toRequisiteCandidate(row, online.includes(row.deviceId));
  }

  async findIdsOfBank(bankId: number): Promise<string[]> {
    const rows = await this.bankDetails.find({
      select: { id: true },
      where: { bankId },
      withDeleted: true,
    });

    return rows.map((row) => row.id);
  }

  requisitesOfDeviceWithin(
    manager: EntityManager,
    deviceId: number,
    userId: string,
  ): Promise<Pick<BankDetails, 'id' | 'bankId'>[]> {
    return manager.getRepository(BankDetails).find({
      select: { id: true, bankId: true },
      where: { deviceId, userId },
      order: { id: 'ASC' },
    });
  }

  async countByDevices(
    deviceIds: readonly number[],
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();

    if (deviceIds.length === 0) return counts;

    const rows = await this.bankDetails.find({
      select: { id: true, deviceId: true },
      where: { deviceId: In([...deviceIds]) },
    });

    for (const row of rows) {
      counts.set(row.deviceId, (counts.get(row.deviceId) ?? 0) + 1);
    }

    return counts;
  }

  async findByIdsWithDeleted(
    ids: string[],
    manager?: EntityManager,
  ): Promise<BankDetails[]> {
    if (ids.length === 0) return [];

    return (manager?.getRepository(BankDetails) ?? this.bankDetails).find({
      where: { id: In(ids) },
      relations: { bank: true, mobileOperator: true },
      withDeleted: true,
    });
  }

  async findById(id: string): Promise<BankDetails> {
    return this.bankDetails.findOne({ where: { id }, relations: RELATIONS });
  }

  async findOwn(id: string, userId: string): Promise<BankDetails> {
    return this.bankDetails.findOne({
      where: { id, userId },
      relations: RELATIONS,
    });
  }

  async updateOwn(
    id: string,
    userId: string,
    changes: OwnBankDetailsChanges,
    impersonatorUserId?: string | null,
  ): Promise<BankDetails> {
    const owned = await this.findOwn(id, userId);

    if (!owned) throw new NotFoundException('Bank details not found');

    if (changes.active === true && owned.bannedAt) {
      throw new ConflictException(
        'These bank details are banned and cannot be activated',
      );
    }

    if (
      changes.active === true &&
      !(await this.devices.findOwn(owned.deviceId, userId))
    ) {
      throw new ConflictException(DEVICE_DELETED);
    }

    const type = changes.type ?? owned.type;
    const becomesMobile =
      type !== owned.type && type === BankDetailsType.Mobile;
    const becomesCardOrSbp =
      type !== owned.type && type === BankDetailsType.CardOrSbp;
    const payload: BankDetailsPayload = {
      type,
      bankId: changes.bankId ?? (becomesMobile ? null : (owned.bankId ?? null)),
      mobileOperatorId:
        changes.mobileOperatorId ??
        (becomesCardOrSbp ? null : (owned.mobileOperatorId ?? null)),
      card: changes.card ?? (becomesMobile ? null : (owned.card ?? null)),
      phone: changes.phone ?? owned.phone ?? null,
    };

    this.assertPayloadFitsType(payload);
    await this.assertReferencesExist({
      bankId: changes.bankId ?? null,
      mobileOperatorId: changes.mobileOperatorId ?? null,
    });

    if (changes.deviceId !== undefined) {
      await this.assertDeviceIsOwnedBy(changes.deviceId, userId);
    }

    this.assertMinAmountNotForced(
      changes.counterpartyOnly ?? owned.counterpartyOnly,
      changes,
    );

    const counterpartyOnly = changes.counterpartyOnly ?? owned.counterpartyOnly;
    const maxCounterparties = this.settledSlots(
      counterpartyOnly,
      changes.maxCounterparties,
      owned.maxCounterparties ?? null,
    );
    const { tagIds: requestedTagIds, ...fields } = changes;
    const tagIds =
      requestedTagIds === undefined
        ? undefined
        : await this.ownTagIds(requestedTagIds, userId);

    const clearsCounterpartyOnly =
      owned.counterpartyOnly && changes.counterpartyOnly === false;
    const wasActive = owned.active;

    await this.bankDetails.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BankDetails);
      const withoutStaleReferences = Object.assign(owned, {
        bank: undefined,
        mobileOperator: undefined,
        tagLinks: undefined,
      });
      await repository.save(
        repository.merge(withoutStaleReferences, {
          ...fields,
          ...payload,
          ...toggledLimits(owned, changes),
          maxCounterparties,
        }),
      );
      if (tagIds !== undefined) {
        await this.replaceTagsWithin(manager, id, tagIds);
      }
      await this.recordOwnChange(
        manager,
        await repository.findOne({
          where: { id },
          relations: { bank: true, mobileOperator: true },
        }),
        changes,
        wasActive,
        impersonatorUserId ?? null,
      );
      if (clearsCounterpartyOnly) {
        await this.counterparties.unbindRequisiteWithin(
          manager,
          id,
          RequisiteEventReason.CounterpartyOnlyCleared,
        );
      }
    });

    return this.findById(id);
  }

  async disableOwnWithin(
    manager: EntityManager,
    id: string,
    userId: string,
    impersonatorUserId: string | null,
  ): Promise<void> {
    const repository = manager.getRepository(BankDetails);
    const details = await repository.findOne({
      where: { id, userId },
      relations: { bank: true, mobileOperator: true },
    });

    if (!details?.active) return;

    await repository.update(id, { active: false });
    await this.recordOwnChange(
      manager,
      details,
      { active: false },
      true,
      impersonatorUserId,
    );
  }

  async supervise(
    id: string,
    supervision: BankDetailsSupervision,
    adminId: string,
  ): Promise<BankDetails> {
    const found = await this.findById(id);

    if (!found) throw new NotFoundException('Bank details not found');

    if (
      supervision.active === true &&
      !(await this.devices.findById(found.deviceId))
    ) {
      throw new ConflictException(DEVICE_DELETED);
    }

    const banning =
      supervision.banned === undefined
        ? {}
        : supervision.banned
          ? { bannedAt: new Date(), bannedByUserId: adminId }
          : { bannedAt: null, bannedByUserId: null };

    const actions = [
      ...(supervision.active !== undefined &&
      supervision.active !== found.active
        ? [
            supervision.active
              ? BankDetailsAction.Enabled
              : BankDetailsAction.Disabled,
          ]
        : []),
      ...(supervision.banned !== undefined &&
      supervision.banned !== Boolean(found.bannedAt)
        ? [
            supervision.banned
              ? BankDetailsAction.Banned
              : BankDetailsAction.Unbanned,
          ]
        : []),
    ];

    await this.bankDetails.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BankDetails);
      await repository.save(
        repository.merge(found, {
          ...(supervision.active !== undefined
            ? { active: supervision.active }
            : {}),
          ...banning,
        }),
      );
      for (const action of actions) {
        await this.audit.record(
          {
            actorUserId: adminId,
            targetUserId: found.userId,
            action,
            metadata: bankDetailsActivityMetadata(found),
          },
          manager,
        );
      }
    });

    return this.findById(id);
  }

  async deleteOwn(
    id: string,
    userId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    const owned = await this.findOwn(id, userId);

    if (!owned) throw new NotFoundException('Bank details not found');

    await this.softDelete(owned, userId, impersonatorUserId);
  }

  async delete(id: string, actorUserId: string): Promise<void> {
    const found = await this.findById(id);

    if (!found) throw new NotFoundException('Bank details not found');

    await this.softDelete(found, actorUserId);
  }

  async deleteDevice(
    deviceId: number,
    actorUserId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    await this.bankDetails.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BankDetails);
      const served = await repository.find({
        where: { deviceId, active: true },
        relations: { bank: true, mobileOperator: true },
      });

      for (const details of served) {
        await repository.update({ id: details.id }, { active: false });
        await this.audit.record(
          {
            actorUserId,
            impersonatorUserId: impersonatorUserId ?? null,
            targetUserId: details.userId,
            action: BankDetailsAction.Disabled,
            metadata: {
              ...bankDetailsActivityMetadata(details),
              reason: 'device_deleted',
              deviceId,
            },
          },
          manager,
        );
      }

      await this.devices.delete(
        deviceId,
        actorUserId,
        manager,
        impersonatorUserId ?? null,
      );
    });
  }

  async deleteOwnDevice(
    deviceId: number,
    userId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    if (!(await this.devices.findOwn(deviceId, userId))) {
      throw new NotFoundException('Device not found');
    }

    await this.deleteDevice(deviceId, userId, impersonatorUserId);
  }

  async countByStatus(
    query: BankDetailsListQuery,
  ): Promise<BankDetailsStatusCounts> {
    const count = (status?: BankDetailsStatus): Promise<number> =>
      this.bankDetails.count({
        where: bankDetailsListWhere({ ...query, status }),
      });
    const [all, active, disabled, banned] = await Promise.all([
      count(),
      count(BankDetailsStatus.Active),
      count(BankDetailsStatus.Disabled),
      count(BankDetailsStatus.Banned),
    ]);

    return { all, active, disabled, banned };
  }

  async boundCounterpartiesOf(ids: string[]): Promise<Map<string, number>> {
    return this.counterparties.countBoundByRequisites(ids);
  }

  async tagsOf(ids: string[]): Promise<Map<string, BankDetailsTagSummary[]>> {
    const tags = new Map<string, BankDetailsTagSummary[]>(
      ids.map((id) => [id, []]),
    );

    if (ids.length === 0) return tags;

    const links = await this.bankDetails.manager.find(BankDetailTagLink, {
      where: { bankDetailsId: In(ids) },
      relations: { tag: true },
      order: { tag: { name: 'ASC' }, tagId: 'ASC' },
    });

    for (const link of links) {
      tags
        .get(link.bankDetailsId)
        ?.push({ id: link.tag.id, name: link.tag.name });
    }

    return tags;
  }

  async listTags(
    userId: string,
    query: TagListQuery,
  ): Promise<Page<BankDetailTag>> {
    const direction = sortDirection(query.sortOrder);

    return toPage(
      await this.tags.findAndCount({
        where: {
          userId,
          ...(query.search
            ? { name: ILike(`%${escapeLikePattern(query.search)}%`) }
            : {}),
        },
        order: { createdAt: direction, id: direction },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }

  async createTag(userId: string, name: string): Promise<BankDetailTag> {
    const normalizedName = name.toLowerCase();

    if (await this.tags.findOne({ where: { userId, normalizedName } })) {
      throw new ConflictException(TAG_TAKEN);
    }

    try {
      return await this.tags.save(
        this.tags.create({ userId, name, normalizedName }),
      );
    } catch (error) {
      if (
        (error as { driverError?: { code?: string } }).driverError?.code ===
        UNIQUE_VIOLATION
      ) {
        throw new ConflictException(TAG_TAKEN);
      }
      throw error;
    }
  }

  async deleteTag(userId: string, id: number): Promise<void> {
    const tag = await this.tags.findOne({ where: { id, userId } });

    if (!tag) throw new NotFoundException(TAG_NOT_FOUND);

    await this.tags.delete({ id });
  }

  async history(
    userId: string,
    query: PageRequest & { sortOrder: SortOrder },
  ): Promise<Page<RequisiteHistoryEntry>> {
    const lastReadAt = await this.reads.lastReadAt(
      userId,
      ActivityReadScope.Requisites,
    );
    const page = await this.audit.list({
      page: query.page,
      limit: query.limit,
      sortBy: AuditSortField.CreatedAt,
      sortOrder: query.sortOrder,
      targetUserId: userId,
      actions: REQUISITE_HISTORY_ACTIONS,
    });

    return page.map((record) => ({
      record,
      unread: lastReadAt === null || record.createdAt > lastReadAt,
    }));
  }

  async historyReadState(userId: string): Promise<RequisiteHistoryReadState> {
    const lastReadAt = await this.reads.lastReadAt(
      userId,
      ActivityReadScope.Requisites,
    );
    const unread = await this.audit.list({
      page: 1,
      limit: 1,
      sortBy: AuditSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
      targetUserId: userId,
      actions: REQUISITE_HISTORY_ACTIONS,
      ...(lastReadAt ? { createdAfter: lastReadAt } : {}),
    });

    return { lastReadAt, unreadCount: unread.meta.total };
  }

  async markHistoryRead(userId: string): Promise<RequisiteHistoryReadState> {
    const lastReadAt = await this.reads.markRead(
      userId,
      ActivityReadScope.Requisites,
      new Date(),
    );

    return { lastReadAt, unreadCount: 0 };
  }

  private settledSlots(
    counterpartyOnly: boolean,
    requested: number | undefined,
    current: number | null,
  ): number | null {
    if (!counterpartyOnly) {
      if (requested !== undefined) {
        throw new BadRequestException(
          'maxCounterparties is only for a counterparty-only requisite',
        );
      }

      return null;
    }

    const slots = requested ?? current;

    if (slots === null) {
      throw new BadRequestException(
        'A counterparty-only requisite needs maxCounterparties',
      );
    }

    return slots;
  }

  private async ownTagIds(ids: number[], userId: string): Promise<number[]> {
    if (ids.length === 0) return [];

    const found = await this.tags.find({
      select: { id: true },
      where: { id: In(ids), userId },
    });

    if (found.length !== ids.length) {
      throw new NotFoundException(TAG_NOT_FOUND);
    }

    return ids;
  }

  private async replaceTagsWithin(
    manager: EntityManager,
    bankDetailsId: string,
    tagIds: number[],
  ): Promise<void> {
    const links = manager.getRepository(BankDetailTagLink);

    await links.delete({ bankDetailsId });
    if (tagIds.length > 0) {
      await links.save(
        tagIds.map((tagId) => links.create({ bankDetailsId, tagId })),
      );
    }
  }

  private async recordOwnChange(
    manager: EntityManager,
    details: BankDetails,
    changes: OwnBankDetailsChanges,
    wasActive: boolean,
    impersonatorUserId: string | null,
  ): Promise<void> {
    const fields = Object.keys(changes);
    const switching = fields.length === 1 && fields[0] === 'active';

    if (switching && changes.active === wasActive) return;

    await this.audit.record(
      {
        actorUserId: details.userId,
        impersonatorUserId,
        targetUserId: details.userId,
        action: switching
          ? changes.active
            ? BankDetailsAction.Enabled
            : BankDetailsAction.Disabled
          : BankDetailsAction.Updated,
        metadata: {
          ...bankDetailsActivityMetadata(details),
          ...(switching ? {} : { fields }),
        },
      },
      manager,
    );
  }

  private async softDelete(
    details: BankDetails,
    actorUserId: string,
    impersonatorUserId?: string | null,
  ): Promise<void> {
    await this.bankDetails.manager.transaction(async (manager) => {
      await manager.getRepository(BankDetails).softDelete(details.id);
      await this.counterparties.unbindRequisiteWithin(
        manager,
        details.id,
        RequisiteEventReason.RequisiteDeleted,
      );

      await this.audit.record(
        {
          actorUserId,
          impersonatorUserId: impersonatorUserId ?? null,
          targetUserId: details.userId,
          action: ActivityAction.BankDetailsDeleted,
          metadata: bankDetailsActivityMetadata(details),
        },
        manager,
      );
    });
  }

  private async lockWithin(
    manager: EntityManager,
    id: string,
  ): Promise<BankDetails> {
    const details = await manager.findOne(BankDetails, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!details) throw new NotFoundException('Bank details not found');

    return details;
  }

  private toRequisiteCandidate(
    row: BankDetails,
    deviceOnline: boolean,
  ): RequisiteCandidate {
    const limit = <T>(enabled: boolean, value: T | null): T | null =>
      enabled ? (value ?? null) : null;

    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      bankId: row.bankId ?? null,
      bankCurrency: row.bank?.currency?.isocode ?? null,
      mobileOperatorId: row.mobileOperatorId ?? null,
      card: row.card ?? null,
      phone: row.phone ?? null,
      deviceId: row.deviceId,
      deviceOnline,
      active: row.active,
      banned: Boolean(row.bannedAt),
      counterpartyOnly: row.counterpartyOnly,
      reserve: row.reserve,
      sameBankOnly: row.sameBankOnly,
      maxCounterparties: row.maxCounterparties ?? null,
      minAmount: row.counterpartyOnly
        ? this.counterpartyMinAmount
        : limit(row.minAmountEnabled, row.minAmount),
      maxAmount: limit(row.maxAmountEnabled, row.maxAmount),
      dailyLimit: limit(row.dailyLimitEnabled, row.dailyLimit),
      monthlyLimit: limit(row.monthlyLimitEnabled, row.monthlyLimit),
      dailyAmountLimit: limit(
        row.dailyAmountLimitEnabled,
        row.dailyAmountLimit,
      ),
      monthlyAmountLimit: limit(
        row.monthlyAmountLimitEnabled,
        row.monthlyAmountLimit,
      ),
      hourlyAmountLimit: limit(
        row.hourlyAmountLimitEnabled,
        row.hourlyAmountLimit,
      ),
      maxActiveTransactions: limit(
        row.maxActiveTransactionsEnabled,
        row.maxActiveTransactions,
      ),
      delayBetweenRequestsSeconds: limit(
        row.delayBetweenRequestsEnabled,
        row.delayBetweenRequests,
      ),
    };
  }

  private assertPayloadFitsType(payload: BankDetailsPayload): void {
    if (payload.type === BankDetailsType.Mobile) {
      if (payload.bankId !== null) {
        throw new BadRequestException('A mobile requisite has no bank');
      }
      if (payload.card !== null) {
        throw new BadRequestException('A mobile requisite carries no card');
      }
      if (payload.phone === null) {
        throw new BadRequestException('A mobile requisite needs a phone');
      }
      if (payload.mobileOperatorId === null) {
        throw new BadRequestException(
          'A mobile requisite needs a mobile operator',
        );
      }

      return;
    }

    if (payload.bankId === null) {
      throw new BadRequestException('A card-or-sbp requisite needs a bank');
    }
    if (payload.mobileOperatorId !== null) {
      throw new BadRequestException(
        'A card-or-sbp requisite has no mobile operator',
      );
    }
    if (payload.card === null && payload.phone === null) {
      throw new BadRequestException(
        'A card-or-sbp requisite needs a card, a phone or both',
      );
    }
  }

  private async assertReferencesExist(
    references: Pick<BankDetailsPayload, 'bankId' | 'mobileOperatorId'>,
  ): Promise<void> {
    if (
      references.bankId !== null &&
      !(await this.banks.findById(references.bankId))
    ) {
      throw new BadRequestException(`Bank ${references.bankId} does not exist`);
    }

    if (
      references.mobileOperatorId !== null &&
      !(await this.mobileOperators.findById(references.mobileOperatorId))
    ) {
      throw new BadRequestException(
        `Mobile operator ${references.mobileOperatorId} does not exist`,
      );
    }
  }

  private async assertDeviceIsOwnedBy(
    deviceId: number,
    userId: string,
  ): Promise<void> {
    if (!(await this.devices.findOwn(deviceId, userId))) {
      throw new BadRequestException(`Device ${deviceId} does not exist`);
    }
  }

  private assertMinAmountNotForced(
    counterpartyOnly: boolean,
    changes: OwnBankDetailsChanges,
  ): void {
    if (!counterpartyOnly) return;

    if (
      changes.minAmountEnabled !== undefined ||
      changes.minAmount !== undefined
    ) {
      throw new ConflictException(
        'A counterparty-only requisite has a fixed minimum amount that cannot be set here',
      );
    }
  }
}
