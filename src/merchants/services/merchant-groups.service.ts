import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Page, toPage } from '../../common/types/page';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { sortDirection } from '../../common/utils/sort-direction';
import { MerchantGroup } from '../entities/merchant-group.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantFlags } from '../types/merchant-flags';
import { MerchantGroupChanges } from '../types/merchant-group-changes';
import { MerchantGroupListQuery } from '../types/merchant-group-list-query';
import { MerchantGroupSortField } from '../types/merchant-group-sort-field.enum';
import { MerchantGroupSummary } from '../types/merchant-group-summary';
import { MerchantGroupView } from '../types/merchant-group-view';
import { isUniqueViolation } from '../utils/is-unique-violation';

const GROUP_NOT_FOUND = 'Merchant group not found';
const NAME_TAKEN = 'A merchant group with this name already exists';
const IN_ANOTHER_GROUP =
  'A merchant is already in another group; remove it from that group first';

const nameKeyOf = (name: string): string => name.trim().toLowerCase();

@Injectable()
export class MerchantGroupsService {
  constructor(
    @InjectRepository(MerchantGroup)
    private readonly groups: Repository<MerchantGroup>,
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: MerchantGroupListQuery,
  ): Promise<Page<MerchantGroupSummary>> {
    const direction = sortDirection(query.sortOrder);
    const order =
      query.sortBy === MerchantGroupSortField.Id
        ? { id: direction }
        : query.sortBy === MerchantGroupSortField.Name
          ? { name: direction, id: direction }
          : { createdAt: direction, id: direction };
    const [groups, total] = await this.groups.findAndCount({
      where: query.search
        ? { name: ILike(`%${escapeLikePattern(query.search)}%`) }
        : {},
      order,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const counts = await this.countMembers(groups.map((group) => group.id));

    return toPage(
      [
        groups.map((group) => ({
          group,
          merchantCount: counts.get(group.id) ?? 0,
        })),
        total,
      ],
      query,
    );
  }

  async findView(id: number): Promise<MerchantGroupView> {
    const group = await this.groups.findOne({ where: { id } });

    if (!group) throw new NotFoundException(GROUP_NOT_FOUND);

    return this.viewOf(this.dataSource.manager, group);
  }

  async create(
    name: string,
    merchantIds: string[],
    actorUserId: string,
  ): Promise<MerchantGroupView> {
    const ids = [...new Set(merchantIds)];

    return this.translateNameClash(() =>
      this.dataSource.transaction(async (manager) => {
        await this.assertNameFree(manager, name);
        await this.assertMerchantsExist(manager, ids);

        const group = await manager.save(
          manager.create(MerchantGroup, {
            name: name.trim(),
            nameKey: nameKeyOf(name),
          }),
        );

        await this.moveIntoWithin(manager, group.id, ids);
        await this.audit.record(
          {
            actorUserId,
            action: 'merchant_group.created',
            metadata: { groupId: group.id, name: group.name, merchantIds: ids },
          },
          manager,
        );

        return this.viewOf(manager, group);
      }),
    );
  }

  async update(
    id: number,
    changes: MerchantGroupChanges,
    actorUserId: string,
  ): Promise<MerchantGroupView> {
    return this.translateNameClash(() =>
      this.dataSource.transaction(async (manager) => {
        const group = await this.lockGroup(manager, id);

        const name = changes.name?.trim();

        if (name !== undefined && name !== group.name) {
          if (nameKeyOf(name) !== group.nameKey) {
            await this.assertNameFree(manager, name);
          }
          await manager.update(MerchantGroup, id, {
            name,
            nameKey: nameKeyOf(name),
          });
          await this.audit.record(
            {
              actorUserId,
              action: 'merchant_group.renamed',
              metadata: { groupId: id, from: group.name, name },
            },
            manager,
          );
        }

        const flags: MerchantFlags = {};

        if (changes.active !== undefined) flags.active = changes.active;
        if (changes.exclusiveTopUp !== undefined) {
          flags.exclusiveTopUp = changes.exclusiveTopUp;
        }

        if (Object.keys(flags).length) {
          await manager.update(Merchant, { groupId: id }, flags);
          const members = await manager.find(Merchant, {
            where: { groupId: id },
            select: { id: true },
          });
          await this.audit.record(
            {
              actorUserId,
              action: 'merchant_group.flags_applied',
              metadata: {
                groupId: id,
                ...flags,
                merchantIds: members.map((member) => member.id),
              },
            },
            manager,
          );
        }

        return this.viewOf(
          manager,
          (await manager.findOne(MerchantGroup, { where: { id } })) ?? group,
        );
      }),
    );
  }

  async addMerchants(
    id: number,
    merchantIds: string[],
    actorUserId: string,
  ): Promise<MerchantGroupView> {
    const ids = [...new Set(merchantIds)];

    return this.dataSource.transaction(async (manager) => {
      const group = await this.lockGroup(manager, id);

      await this.assertMerchantsExist(manager, ids);

      const fresh = (
        await manager.find(Merchant, { where: { id: In(ids) } })
      ).filter((merchant) => merchant.groupId !== id);

      await this.moveIntoWithin(
        manager,
        id,
        fresh.map((merchant) => merchant.id),
      );

      if (fresh.length) {
        await this.audit.record(
          {
            actorUserId,
            action: 'merchant_group.merchants_added',
            metadata: {
              groupId: id,
              merchantIds: fresh.map((merchant) => merchant.id),
            },
          },
          manager,
        );
      }

      return this.viewOf(manager, group);
    });
  }

  async removeMerchant(
    id: number,
    merchantId: string,
    actorUserId: string,
  ): Promise<MerchantGroupView | null> {
    return this.dataSource.transaction(async (manager) => {
      const group = await this.lockGroup(manager, id);
      const merchant = await manager.findOne(Merchant, {
        where: { id: merchantId, groupId: id },
      });

      if (!merchant) {
        throw new NotFoundException('The merchant is not in this group');
      }

      await manager.update(Merchant, merchantId, { groupId: null });
      await this.audit.record(
        {
          actorUserId,
          action: 'merchant_group.merchant_removed',
          metadata: { groupId: id, merchantId },
        },
        manager,
      );

      return (await this.deleteIfEmptyWithin(manager, group, actorUserId))
        ? null
        : this.viewOf(manager, group);
    });
  }

  async lockGroupsWithin(
    manager: EntityManager,
    groupIds: (number | null)[],
  ): Promise<void> {
    const ids = [
      ...new Set(groupIds.filter((id): id is number => id !== null)),
    ].sort((one, other) => one - other);

    for (const id of ids) {
      await manager.findOne(MerchantGroup, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
    }
  }

  async moveWithin(
    manager: EntityManager,
    merchant: Merchant,
    groupId: number | null,
    actorUserId: string,
  ): Promise<void> {
    if (merchant.groupId === groupId) return;

    if (groupId === null) {
      const previous = await this.lockGroup(
        manager,
        merchant.groupId as number,
      );

      await manager.update(Merchant, merchant.id, { groupId: null });
      await this.audit.record(
        {
          actorUserId,
          action: 'merchant_group.merchant_removed',
          metadata: { groupId: previous.id, merchantId: merchant.id },
        },
        manager,
      );
      await this.deleteIfEmptyWithin(manager, previous, actorUserId);
      return;
    }

    const group = await manager.findOne(MerchantGroup, {
      where: { id: groupId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!group) throw new BadRequestException('Merchant group not found');

    await this.moveIntoWithin(manager, groupId, [merchant.id]);
    await this.audit.record(
      {
        actorUserId,
        action: 'merchant_group.merchants_added',
        metadata: { groupId, merchantIds: [merchant.id] },
      },
      manager,
    );
  }

  private async moveIntoWithin(
    manager: EntityManager,
    groupId: number,
    merchantIds: string[],
  ): Promise<void> {
    if (!merchantIds.length) return;

    const result = await manager
      .createQueryBuilder()
      .update(Merchant)
      .set({ groupId })
      .where('id IN (:...ids)', { ids: merchantIds })
      .andWhere('"groupId" IS NULL')
      .execute();

    if (result.affected !== merchantIds.length) {
      throw new ConflictException(IN_ANOTHER_GROUP);
    }
  }

  private async deleteIfEmptyWithin(
    manager: EntityManager,
    group: MerchantGroup,
    actorUserId: string,
  ): Promise<boolean> {
    const left = await manager.count(Merchant, {
      where: { groupId: group.id },
    });

    if (left > 0) return false;

    await manager.delete(MerchantGroup, group.id);
    await this.audit.record(
      {
        actorUserId,
        action: 'merchant_group.deleted',
        metadata: { groupId: group.id, name: group.name },
      },
      manager,
    );

    return true;
  }

  private async lockGroup(
    manager: EntityManager,
    id: number,
  ): Promise<MerchantGroup> {
    const group = await manager.findOne(MerchantGroup, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!group) throw new NotFoundException(GROUP_NOT_FOUND);

    return group;
  }

  private async assertNameFree(
    manager: EntityManager,
    name: string,
  ): Promise<void> {
    const clash = await manager.findOne(MerchantGroup, {
      where: { nameKey: nameKeyOf(name) },
    });

    if (clash) throw new ConflictException(NAME_TAKEN);
  }

  private async assertMerchantsExist(
    manager: EntityManager,
    ids: string[],
  ): Promise<void> {
    const found = await manager.find(Merchant, {
      where: { id: In(ids) },
      select: { id: true },
    });

    if (found.length !== ids.length) {
      throw new BadRequestException('Unknown merchant in the list');
    }
  }

  private async viewOf(
    manager: EntityManager,
    group: MerchantGroup,
  ): Promise<MerchantGroupView> {
    return {
      group,
      merchants: await manager.find(Merchant, {
        where: { groupId: group.id },
        order: { name: 'ASC', id: 'ASC' },
      }),
    };
  }

  private async countMembers(groupIds: number[]): Promise<Map<number, number>> {
    if (!groupIds.length) return new Map();

    const rows = await this.merchants
      .createQueryBuilder('merchant')
      .select('merchant.groupId', 'groupId')
      .addSelect('COUNT(*)', 'count')
      .where('merchant.groupId IN (:...groupIds)', { groupIds })
      .groupBy('merchant.groupId')
      .getRawMany<{ groupId: number; count: string }>();

    return new Map(rows.map((row) => [Number(row.groupId), Number(row.count)]));
  }

  private async translateNameClash<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(NAME_TAKEN);
      throw error;
    }
  }
}
